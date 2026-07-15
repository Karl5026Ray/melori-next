-- 023_melori_connect_dating.sql
-- Melori Connect — music-affinity dating feature (P0 Foundation + P1 MVP loop).
--
-- Additive only. Every table here is namespaced `dating_*` and references the
-- existing `profiles(id)` / `auth.users(id)` PKs so that platform-level blocks
-- (`member_blocks`), follows, and the profile gallery all compose automatically
-- and no existing table is overloaded.
--
-- All tables enable Row Level Security from creation. Server routes use the
-- service-role client (bypasses RLS), but the policies below cover any direct
-- anon/authenticated access and are the real security boundary. Dating is
-- strictly 18+: enforced both at the app layer AND here via a DB trigger on
-- dating_profiles insert/update (computed from dob).

-- ---------------------------------------------------------------------------
-- dating_profiles — 1:1 opt-in layer over profiles. is_active is the opt-in
-- flag; a member is never auto-enrolled.
-- ---------------------------------------------------------------------------
create table if not exists public.dating_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  is_active boolean not null default false,
  dob date not null,
  over_18 boolean not null default false,
  intent text not null default 'either' check (intent in ('dating', 'friends', 'either')),
  shown_gender text,
  seeking_gender text[] not null default '{}',
  age_min int not null default 18,
  age_max int not null default 99,
  max_distance_km int not null default 160,
  bio_override text,
  verified boolean not null default false,
  -- Separate, explicit consent for dating-specific + sensitive data
  -- (orientation, dating intent). Not bundled into the general ToS.
  consent_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 18+ enforcement at the DB layer. Computes age from dob on every insert/update
-- and rejects under-18, and keeps over_18 in sync so it can never lie.
create or replace function public.dating_profiles_enforce_age()
returns trigger
language plpgsql
as $$
declare
  computed_age int;
begin
  computed_age := date_part('year', age(current_date, new.dob))::int;
  if computed_age < 18 then
    raise exception 'Melori Connect requires all members to be at least 18 years old';
  end if;
  new.over_18 := true;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dating_profiles_age_trg on public.dating_profiles;
create trigger dating_profiles_age_trg
  before insert or update on public.dating_profiles
  for each row execute function public.dating_profiles_enforce_age();

alter table public.dating_profiles enable row level security;

-- Discoverable when active. Owner-scoped writes.
drop policy if exists dating_profiles_select_active on public.dating_profiles;
create policy dating_profiles_select_active on public.dating_profiles
  for select using (is_active = true or profile_id = auth.uid());

drop policy if exists dating_profiles_insert_own on public.dating_profiles;
create policy dating_profiles_insert_own on public.dating_profiles
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists dating_profiles_update_own on public.dating_profiles;
create policy dating_profiles_update_own on public.dating_profiles
  for update to authenticated using (profile_id = auth.uid());

drop policy if exists dating_profiles_delete_own on public.dating_profiles;
create policy dating_profiles_delete_own on public.dating_profiles
  for delete to authenticated using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_prompts — admin-curated prompt library (music-flavored).
-- ---------------------------------------------------------------------------
create table if not exists public.dating_prompts (
  id serial primary key,
  text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.dating_prompts enable row level security;

drop policy if exists dating_prompts_select_active on public.dating_prompts;
create policy dating_prompts_select_active on public.dating_prompts
  for select using (is_active = true);

drop policy if exists dating_prompts_admin_all on public.dating_prompts;
create policy dating_prompts_admin_all on public.dating_prompts
  for all using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- dating_profile_prompts — up to 3 answers per member (cap enforced in app).
-- ---------------------------------------------------------------------------
create table if not exists public.dating_profile_prompts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  prompt_id int not null references public.dating_prompts(id) on delete cascade,
  answer text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (profile_id, prompt_id)
);

create index if not exists dating_profile_prompts_profile_idx
  on public.dating_profile_prompts(profile_id, sort_order);

alter table public.dating_profile_prompts enable row level security;

drop policy if exists dating_profile_prompts_select_all on public.dating_profile_prompts;
create policy dating_profile_prompts_select_all on public.dating_profile_prompts
  for select using (true);

drop policy if exists dating_profile_prompts_write_own on public.dating_profile_prompts;
create policy dating_profile_prompts_write_own on public.dating_profile_prompts
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_profile_photos — ordered refs into EXISTING media URLs (no binaries).
-- ---------------------------------------------------------------------------
create table if not exists public.dating_profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists dating_profile_photos_profile_idx
  on public.dating_profile_photos(profile_id, sort_order);

alter table public.dating_profile_photos enable row level security;

drop policy if exists dating_profile_photos_select_all on public.dating_profile_photos;
create policy dating_profile_photos_select_all on public.dating_profile_photos
  for select using (true);

drop policy if exists dating_profile_photos_write_own on public.dating_profile_photos;
create policy dating_profile_photos_write_own on public.dating_profile_photos
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_preferences — free-form dealbreakers bag.
-- ---------------------------------------------------------------------------
create table if not exists public.dating_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  dealbreakers jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.dating_preferences enable row level security;

drop policy if exists dating_preferences_own on public.dating_preferences;
create policy dating_preferences_own on public.dating_preferences
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_music_affinity_cache — precomputed taste features (P2 pgvector-ready).
-- ---------------------------------------------------------------------------
create table if not exists public.dating_music_affinity_cache (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  taste_vector jsonb,
  top_artists jsonb,
  top_genres jsonb,
  computed_at timestamptz not null default now()
);

alter table public.dating_music_affinity_cache enable row level security;

drop policy if exists dating_affinity_select_own on public.dating_music_affinity_cache;
create policy dating_affinity_select_own on public.dating_music_affinity_cache
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists dating_affinity_write_own on public.dating_music_affinity_cache;
create policy dating_affinity_write_own on public.dating_music_affinity_cache
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_actions — like / pass / super_like, with optional comment-on-like.
-- One row per (actor, target); references profiles(id) so blocks compose.
-- ---------------------------------------------------------------------------
create table if not exists public.dating_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('like', 'pass', 'super_like')),
  comment text,
  created_at timestamptz not null default now(),
  unique (actor_id, target_id),
  constraint dating_actions_no_self check (actor_id <> target_id)
);

create index if not exists dating_actions_target_idx
  on public.dating_actions(target_id, action);

alter table public.dating_actions enable row level security;

-- A member can see their own actions and any action targeting them (needed for
-- the reciprocal-like check on the client side; the trigger below does the
-- real matching server-side).
drop policy if exists dating_actions_select_involved on public.dating_actions;
create policy dating_actions_select_involved on public.dating_actions
  for select to authenticated using (actor_id = auth.uid() or target_id = auth.uid());

drop policy if exists dating_actions_insert_own on public.dating_actions;
create policy dating_actions_insert_own on public.dating_actions
  for insert to authenticated with check (actor_id = auth.uid());

drop policy if exists dating_actions_update_own on public.dating_actions;
create policy dating_actions_update_own on public.dating_actions
  for update to authenticated using (actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_matches — canonical (least,greatest) pair, soft unmatch state.
-- ---------------------------------------------------------------------------
create table if not exists public.dating_matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'unmatched', 'expired')),
  created_at timestamptz not null default now(),
  unmatched_by uuid references public.profiles(id) on delete set null,
  unmatched_at timestamptz,
  unique (user_a, user_b),
  -- Enforce canonical ordering so a pair can only ever have one row.
  constraint dating_matches_canonical check (user_a < user_b)
);

create index if not exists dating_matches_user_a_idx on public.dating_matches(user_a);
create index if not exists dating_matches_user_b_idx on public.dating_matches(user_b);

alter table public.dating_matches enable row level security;

drop policy if exists dating_matches_select_participant on public.dating_matches;
create policy dating_matches_select_participant on public.dating_matches
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- Participants may update (unmatch) their own match rows.
drop policy if exists dating_matches_update_participant on public.dating_matches;
create policy dating_matches_update_participant on public.dating_matches
  for update to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- ---------------------------------------------------------------------------
-- Block composition helper. member_blocks SELECT RLS only exposes rows where
-- the caller is the blocker, so "did THEY block ME?" is not answerable from a
-- normal policy. This SECURITY DEFINER function reads both directions and is
-- the single source of truth used by the match RPC, the trigger, and RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.member_blocks mb
    where (mb.blocker_id = a and mb.blocked_id = b)
       or (mb.blocker_id = b and mb.blocked_id = a)
  );
$$;

-- ---------------------------------------------------------------------------
-- Atomic like/match path. Routing every action through this RPC closes the
-- concurrent-reciprocal-like race: a transaction-level advisory lock on the
-- canonical pair serializes the two directions, so exactly one of them observes
-- the other's committed row and creates the (single) match. The insert trigger
-- below is kept but is harmless/idempotent thanks to ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------
create or replace function public.create_dating_action(
  p_actor uuid,
  p_target uuid,
  p_action text,
  p_comment text default null
)
returns table (matched boolean, match_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid := least(p_actor, p_target);
  b uuid := greatest(p_actor, p_target);
  reciprocal boolean;
  m_id uuid;
begin
  if p_actor = p_target then
    raise exception 'You cannot act on yourself';
  end if;
  if p_action not in ('like', 'pass', 'super_like') then
    raise exception 'Invalid action';
  end if;

  -- Serialize both directions of this pair for the life of the transaction.
  perform pg_advisory_xact_lock(
    hashtextextended(a::text || ':' || b::text, 0)
  );

  -- A block either way voids the interaction; record nothing, match nothing.
  if public.is_blocked_either_way(p_actor, p_target) then
    return query select false, null::uuid;
    return;
  end if;

  -- Record the action; re-likes update in place (pass -> like, etc.).
  insert into public.dating_actions (actor_id, target_id, action, comment)
  values (p_actor, p_target, p_action, p_comment)
  on conflict (actor_id, target_id)
  do update set action = excluded.action, comment = excluded.comment;

  matched := false;
  match_id := null;

  if p_action in ('like', 'super_like') then
    select exists (
      select 1 from public.dating_actions da
      where da.actor_id = p_target
        and da.target_id = p_actor
        and da.action in ('like', 'super_like')
    ) into reciprocal;

    if reciprocal then
      insert into public.dating_matches (user_a, user_b, status)
      values (a, b, 'active')
      on conflict (user_a, user_b) do nothing;

      select id into m_id from public.dating_matches
      where user_a = a and user_b = b and status = 'active';

      matched := m_id is not null;
      match_id := m_id;
    end if;
  end if;

  return query select matched, match_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Match trigger: on a like / super_like, if the target already liked the actor
-- back AND neither has blocked the other, create the canonical match atomically.
-- Retained as a safety net for any direct insert that bypasses the RPC; the
-- ON CONFLICT DO NOTHING makes a double-create harmless.
-- ---------------------------------------------------------------------------
create or replace function public.dating_actions_try_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reciprocal boolean;
  blocked boolean;
  a uuid;
  b uuid;
begin
  if new.action not in ('like', 'super_like') then
    return new;
  end if;

  -- Does the target already like the actor back?
  select exists (
    select 1 from public.dating_actions da
    where da.actor_id = new.target_id
      and da.target_id = new.actor_id
      and da.action in ('like', 'super_like')
  ) into reciprocal;

  if not reciprocal then
    return new;
  end if;

  -- Platform block in either direction voids the match.
  blocked := public.is_blocked_either_way(new.actor_id, new.target_id);

  if blocked then
    return new;
  end if;

  a := least(new.actor_id, new.target_id);
  b := greatest(new.actor_id, new.target_id);

  insert into public.dating_matches (user_a, user_b, status)
  values (a, b, 'active')
  on conflict (user_a, user_b) do nothing;

  return new;
end;
$$;

drop trigger if exists dating_actions_match_trg on public.dating_actions;
create trigger dating_actions_match_trg
  after insert or update on public.dating_actions
  for each row execute function public.dating_actions_try_match();

-- ---------------------------------------------------------------------------
-- dating_messages — match-gated messaging. Readable only by the two
-- participants and only while the match is active. Never hard-deleted on
-- unmatch (preserves reporting evidence).
-- ---------------------------------------------------------------------------
create table if not exists public.dating_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.dating_matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists dating_messages_match_idx
  on public.dating_messages(match_id, created_at);

alter table public.dating_messages enable row level security;

-- Only the two participants of an ACTIVE match can read its messages.
drop policy if exists dating_messages_select_participant on public.dating_messages;
create policy dating_messages_select_participant on public.dating_messages
  for select to authenticated using (
    exists (
      select 1 from public.dating_matches m
      where m.id = dating_messages.match_id
        and m.status = 'active'
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- Sender must be a participant of an active match and can only write as self.
drop policy if exists dating_messages_insert_participant on public.dating_messages;
create policy dating_messages_insert_participant on public.dating_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.dating_matches m
      where m.id = dating_messages.match_id
        and m.status = 'active'
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- dating_reports — safety reports. Readable only by the reporter (+ admin);
-- NEVER by the reported user.
-- ---------------------------------------------------------------------------
create table if not exists public.dating_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('harassment', 'fake_profile', 'underage', 'ncii', 'other')),
  detail text,
  -- Evidence linkage: when a report originates from a conversation we pin the
  -- match / offending message so the preserved-after-unmatch history is
  -- actually retrievable by the reporter + moderators. `snapshot` captures the
  -- reported content at report time so it survives edits/deletes. These are
  -- readable via the reporter/admin SELECT policy only — never by the reported
  -- user. ON DELETE SET NULL keeps a report standing even if the row is purged.
  match_id uuid references public.dating_matches(id) on delete set null,
  message_id uuid references public.dating_messages(id) on delete set null,
  snapshot text,
  created_at timestamptz not null default now()
);

create index if not exists dating_reports_reported_idx
  on public.dating_reports(reported_id);

alter table public.dating_reports enable row level security;

drop policy if exists dating_reports_select_reporter_or_admin on public.dating_reports;
create policy dating_reports_select_reporter_or_admin on public.dating_reports
  for select to authenticated using (
    reporter_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists dating_reports_insert_own on public.dating_reports;
create policy dating_reports_insert_own on public.dating_reports
  for insert to authenticated with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dating_post_connection_feedback — private "We Met" analogue (P2 surface).
-- Never shown to the other party; informs future scoring only.
-- ---------------------------------------------------------------------------
create table if not exists public.dating_post_connection_feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  met boolean not null,
  created_at timestamptz not null default now()
);

alter table public.dating_post_connection_feedback enable row level security;

drop policy if exists dating_feedback_own on public.dating_post_connection_feedback;
create policy dating_feedback_own on public.dating_post_connection_feedback
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Seed the music-flavored prompt library (idempotent).
-- ---------------------------------------------------------------------------
insert into public.dating_prompts (text)
select t.text from (values
  ('The song I''d play to make a first impression'),
  ('A concert I''d relive in a heartbeat'),
  ('An artist I''ll defend to the death'),
  ('My most-repeated song this month'),
  ('The genre that always finds me'),
  ('A lyric that lives rent-free in my head'),
  ('The soundtrack to my perfect Sunday'),
  ('A song we have to hear live together')
) as t(text)
where not exists (
  select 1 from public.dating_prompts p where p.text = t.text
);
