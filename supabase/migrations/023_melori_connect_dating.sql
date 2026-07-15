-- 023_melori_connect_dating.sql
-- =============================================================================
-- Melori Connect — dating / matching feature (v1).
--
-- Reuses existing platform primitives where possible:
--   * profiles           — identity, avatar, bio, membership_tier (gating)
--   * conversations      — a mutual match opens a DM (via matches.conversation_id)
--   * member_blocks      — safety: blocked users never appear in discovery
--   * track_listens / follows / saved_playlist_tracks — music-taste signal
--
-- New objects:
--   * dating_profiles    — per-user dating opt-in + preferences (age/gender/
--                          looking_for/location/prompts). Row exists only for
--                          users who joined Connect.
--   * match_likes        — directional swipe: liker -> liked, action like|pass.
--                          UNIQUE(liker_id, liked_id) so re-swipes are idempotent.
--   * matches            — a mutual like. One row per unordered pair
--                          (user_a < user_b enforced) + optional conversation_id.
--   * compatibility_score(a,b) — music-taste + preference blend (0..100).
--
-- Idempotent; safe to re-run.
-- =============================================================================

-- ---- dating_profiles ---------------------------------------------------------
create table if not exists public.dating_profiles (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  is_active    boolean not null default true,        -- opted into Connect + discoverable
  birthdate    date,
  gender       text check (gender in ('woman','man','nonbinary','other') or gender is null),
  -- who they want to see; array so "everyone" = all three
  interested_in text[] not null default array['woman','man','nonbinary']::text[],
  age_min      integer not null default 18 check (age_min >= 18),
  age_max      integer not null default 99 check (age_max >= 18),
  city         text,
  -- coarse location for distance-lite ranking (optional, no PII precision)
  lat          double precision,
  lng          double precision,
  max_distance_km integer default 200,
  headline     text,            -- short one-liner shown on the card
  prompts      jsonb not null default '[]'::jsonb,   -- [{q,a}] icebreaker prompts
  photos       text[] not null default array[]::text[], -- Supabase Storage URLs
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint dating_age_range_ok check (age_max >= age_min)
);

create index if not exists idx_dating_profiles_active
  on public.dating_profiles (is_active) where is_active = true;

-- ---- match_likes (directional swipe) ----------------------------------------
create table if not exists public.match_likes (
  id         uuid primary key default gen_random_uuid(),
  liker_id   uuid not null references public.profiles(id) on delete cascade,
  liked_id   uuid not null references public.profiles(id) on delete cascade,
  action     text not null default 'like' check (action in ('like','pass','superlike')),
  created_at timestamptz not null default now(),
  unique (liker_id, liked_id),
  check (liker_id <> liked_id)
);

create index if not exists idx_match_likes_liked
  on public.match_likes (liked_id, action);
create index if not exists idx_match_likes_liker
  on public.match_likes (liker_id, action);

-- ---- matches (mutual) --------------------------------------------------------
-- One row per unordered pair; user_a is always the lexicographically smaller id
-- so we can enforce uniqueness and look up either direction cheaply.
create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create index if not exists idx_matches_user_a on public.matches (user_a);
create index if not exists idx_matches_user_b on public.matches (user_b);

-- updated_at touch for dating_profiles
create or replace function public.touch_dating_profile()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_dating_profile on public.dating_profiles;
create trigger trg_touch_dating_profile
  before update on public.dating_profiles
  for each row execute function public.touch_dating_profile();

-- =============================================================================
-- compatibility_score(a, b) -> integer 0..100
-- Blend of music-taste overlap and preference fit. Deterministic + cheap enough
-- to compute per candidate in the discovery query.
--   music (up to 70):
--     shared listened tracks   (Jaccard-ish, capped)         up to 30
--     shared follows (artists) (overlap of following sets)   up to 25
--     shared saved playlist tracks                           up to 15
--   preference (up to 30):
--     mutual gender/interested_in fit                        20
--     age within both ranges                                 10
-- Returns 0 when either side has no dating profile.
-- =============================================================================
create or replace function public.compatibility_score(a uuid, b uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  music_score numeric := 0;
  pref_score  numeric := 0;
  shared_listens int;
  a_listens int; b_listens int;
  shared_follows int;
  shared_saved int;
  pa public.dating_profiles%rowtype;
  pb public.dating_profiles%rowtype;
  a_age int; b_age int;
begin
  -- shared listened tracks (distinct studio_track_id per user)
  select count(*) into shared_listens from (
    select distinct studio_track_id from public.track_listens
      where listener_id = a and studio_track_id is not null
    intersect
    select distinct studio_track_id from public.track_listens
      where listener_id = b and studio_track_id is not null
  ) s;
  select count(distinct studio_track_id) into a_listens from public.track_listens
    where listener_id = a and studio_track_id is not null;
  select count(distinct studio_track_id) into b_listens from public.track_listens
    where listener_id = b and studio_track_id is not null;
  if coalesce(least(a_listens,b_listens),0) > 0 then
    music_score := music_score + least(30.0,
      30.0 * shared_listens / greatest(least(a_listens,b_listens),1));
  end if;

  -- shared follows (people/artists both follow)
  select count(*) into shared_follows from (
    select following_id from public.follows where follower_id = a
    intersect
    select following_id from public.follows where follower_id = b
  ) s;
  music_score := music_score + least(25.0, shared_follows * 5.0);

  -- shared saved playlist tracks
  select count(*) into shared_saved from (
    select spt.studio_track_id
      from public.saved_playlist_tracks spt
      join public.saved_playlists sp on sp.id = spt.playlist_id
      where sp.owner_id = a and spt.studio_track_id is not null
    intersect
    select spt.studio_track_id
      from public.saved_playlist_tracks spt
      join public.saved_playlists sp on sp.id = spt.playlist_id
      where sp.owner_id = b and spt.studio_track_id is not null
  ) s;
  music_score := music_score + least(15.0, shared_saved * 3.0);

  -- preference fit
  select * into pa from public.dating_profiles where user_id = a;
  select * into pb from public.dating_profiles where user_id = b;
  if pa.user_id is null or pb.user_id is null then
    return greatest(0, round(music_score))::int; -- music-only if no prefs
  end if;

  -- mutual gender interest
  if (pb.gender is null or pb.gender = any(pa.interested_in))
     and (pa.gender is null or pa.gender = any(pb.interested_in)) then
    pref_score := pref_score + 20;
  end if;

  -- age within both ranges
  a_age := case when pa.birthdate is not null
    then extract(year from age(pa.birthdate))::int else null end;
  b_age := case when pb.birthdate is not null
    then extract(year from age(pb.birthdate))::int else null end;
  if a_age is not null and b_age is not null
     and b_age between pa.age_min and pa.age_max
     and a_age between pb.age_min and pb.age_max then
    pref_score := pref_score + 10;
  end if;

  return least(100, greatest(0, round(music_score + pref_score)))::int;
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.dating_profiles enable row level security;
alter table public.match_likes    enable row level security;
alter table public.matches        enable row level security;

-- dating_profiles: active profiles are readable by any signed-in user (needed
-- for discovery cards); a user fully manages only their own row.
drop policy if exists "dating read active" on public.dating_profiles;
create policy "dating read active" on public.dating_profiles
  for select using (is_active = true or auth.uid() = user_id);
drop policy if exists "dating upsert own" on public.dating_profiles;
create policy "dating insert own" on public.dating_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "dating update own" on public.dating_profiles;
create policy "dating update own" on public.dating_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "dating delete own" on public.dating_profiles;
create policy "dating delete own" on public.dating_profiles
  for delete using (auth.uid() = user_id);

-- match_likes: a user can see and create only their own swipes. "Who liked you"
-- is served through a SECURITY DEFINER endpoint (service role), not direct read,
-- so likers stay hidden from free users at the row level.
drop policy if exists "likes own read" on public.match_likes;
create policy "likes own read" on public.match_likes
  for select using (auth.uid() = liker_id);
drop policy if exists "likes own insert" on public.match_likes;
create policy "likes own insert" on public.match_likes
  for insert with check (auth.uid() = liker_id);
drop policy if exists "likes own delete" on public.match_likes;
create policy "likes own delete" on public.match_likes
  for delete using (auth.uid() = liker_id);

-- matches: each participant can read their matches.
drop policy if exists "matches participant read" on public.matches;
create policy "matches participant read" on public.matches
  for select using (auth.uid() = user_a or auth.uid() = user_b);
