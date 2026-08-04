-- 050_cinema_screenings.sql
--
-- MM Cinema — the long-form / premiere surface that takes Connect's slot in the
-- Social nav group. Deliberately NOT another feed: Mirror already owns
-- short-form vertical video and MM Faces owns live camera rooms. Cinema owns
-- *scheduled, sit-down viewing* — an artist premiere, a documentary, a concert
-- film — with an optional synced watch party and an optional paid ticket.
--
-- v1 is read-only in the app: rows are seeded by admins. Ticketing columns are
-- present but unused until Stripe wiring lands, so the schema doesn't need a
-- second migration to turn payments on.

create table if not exists public.cinema_screenings (
  id uuid primary key default gen_random_uuid(),

  -- Presentation
  title            text        not null,
  synopsis         text,
  poster_url       text,
  trailer_url      text,
  -- Where the feature itself streams from. Either a Supabase storage path or a
  -- normalized YouTube id, mirroring how social_videos handles the two sources.
  video_url        text,
  youtube_id       text,
  runtime_seconds  integer,

  -- Who it belongs to. Nullable so Melori-programmed screenings (no single
  -- artist) are representable.
  artist_id  uuid references public.profiles(id) on delete set null,

  -- Programming
  -- draft     → not visible to members
  -- scheduled → shows in Upcoming, counts down to starts_at
  -- live      → synced watch party in progress
  -- available → on-demand, watch any time
  -- ended     → archived, shows in Past
  status     text not null default 'draft'
    check (status in ('draft', 'scheduled', 'live', 'available', 'ended')),
  starts_at  timestamptz,
  ends_at    timestamptz,

  -- Synced watch party. When true the screening plays on a shared clock for
  -- everyone in the room (Teleparty-style) instead of per-viewer playback.
  is_watch_party boolean not null default false,
  -- Reuses the existing LiveKit room plumbing for party chat/reactions.
  livekit_room   text,

  -- Access. 'free' = any signed-in member, 'superfan' = Superfan+ tier,
  -- 'ticketed' = requires a paid ticket (Stripe, not yet wired in v1).
  access_tier  text not null default 'free'
    check (access_tier in ('free', 'superfan', 'ticketed')),
  price_cents  integer check (price_cents is null or price_cents >= 0),

  -- Rights hygiene. Cinema carries longer, more licensable works than Mirror,
  -- so we record who cleared it up front rather than retrofitting it after a
  -- takedown (see 049_rights_takedowns_and_strikes.sql).
  rights_cleared_by uuid references public.profiles(id) on delete set null,
  rights_note       text,

  views_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The two queries the shelf actually runs: "what's coming up" and "what can I
-- watch right now", both ordered by time.
create index if not exists cinema_screenings_status_starts_at_idx
  on public.cinema_screenings (status, starts_at desc);
create index if not exists cinema_screenings_artist_idx
  on public.cinema_screenings (artist_id);

alter table public.cinema_screenings enable row level security;

-- Public read of everything except drafts. Matches the rest of MM Social:
-- free members can look, tier gating happens at playback, not at listing.
drop policy if exists "cinema_screenings_public_read" on public.cinema_screenings;
create policy "cinema_screenings_public_read"
  on public.cinema_screenings for select
  using (status <> 'draft');

-- Writes are admin-only in v1. Artists get a submit flow later; until then the
-- service role / admin panel is the single write path.
drop policy if exists "cinema_screenings_admin_write" on public.cinema_screenings;
create policy "cinema_screenings_admin_write"
  on public.cinema_screenings for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

comment on table public.cinema_screenings is
  'MM Cinema programming: scheduled premieres, on-demand features, and synced watch parties. Distinct from social_videos (short-form Mirror) and spaces (live rooms).';
