-- 050_cinema_room_format.sql
--
-- MM Cinema is a ROOM FORMAT, not a second app.
--
-- An earlier draft of this migration created a standalone `cinema_screenings`
-- table modelled on a Netflix-style poster shelf. The actual design (see the
-- phone mockups) is a live watch party: a shared screen with host + guest
-- stage seats, an audience grid, live chat, and gifting. That is exactly what
-- `spaces` + `space_participants` + `space_comments` already do, so Cinema
-- joins Release Party / Discussion / Versus Battle / DJ Set as a fifth format
-- instead of duplicating the room engine.
--
-- Reusing `spaces` means Cinema inherits, with no new code:
--   * server-authoritative host/speaker/audience roles (028)
--   * the ordered raise-hand queue + trigger (028)
--   * host moderation and room-scoped bans (037)
--   * unified end-room teardown and host_last_seen_at reaping (048, PR #259)
--   * the mobile room layout + floating-player suppression contracts
--
-- Drop the abandoned draft table if any environment actually applied it.
drop table if exists public.cinema_screenings;

-- ---------------------------------------------------------------------------
-- Widen the room_format CHECK to admit 'cinema'.
--
-- This is the load-bearing line of the migration. `spaces_room_format_check`
-- is an allowlist, so without it every attempt to create a Cinema room fails
-- with a 23514 and the discover screen stays permanently empty.
--
-- The rewritten list intentionally preserves live_solo / live_duo / live_group
-- (the MM Faces video formats). They exist in the database but are absent from
-- the RoomFormat union in src/types/social.ts, so anyone reconstructing this
-- constraint from the TypeScript alone would silently drop them and break
-- every existing Faces room.
-- ---------------------------------------------------------------------------
alter table public.spaces
  drop constraint if exists spaces_room_format_check;

alter table public.spaces
  add constraint spaces_room_format_check check (
    room_format = any (array[
      'release_party',
      'versus_battle',
      'discussion',
      'dj_set',
      -- MM Faces video formats.
      'live_solo',
      'live_duo',
      'live_group',
      -- MM Cinema watch party.
      'cinema'
    ]::text[])
  );

-- ---------------------------------------------------------------------------
-- Genre tag for the Cinema discover screen.
--
-- The discover mockup filters rooms by genre (live now / hip hop / r&b /
-- afrobeats / pop). `genres` already exists as a lookup table, but rooms had
-- no genre of their own — an audio Space inherited nothing and a Cinema room
-- has no single track to derive one from. This is a free-text slug rather than
-- a FK so a host can tag a room before the genre list is finalised, and so a
-- retired genre row can't cascade-null live rooms mid-broadcast.
--
-- Null = untagged; those rooms still appear under the default "live now" tab.
-- ---------------------------------------------------------------------------
alter table public.spaces
  add column if not exists genre text;

-- The discover screen's two queries are "cinema rooms that are live" and
-- "cinema rooms starting soon", both optionally narrowed by genre. A partial
-- index keeps this off the much larger audio-Spaces working set.
create index if not exists spaces_cinema_discover_idx
  on public.spaces (status, genre, scheduled_at)
  where room_format = 'cinema';

comment on column public.spaces.genre is
  'Optional genre slug used by the MM Cinema discover screen filter tabs. Free text, not a FK to genres(slug), so hosts can tag rooms independently of the lookup table.';

-- ---------------------------------------------------------------------------
-- "Starting soon" reminders.
--
-- The discover mockup's STARTING SOON rows each carry a bell. This table backs
-- that toggle. It closes a real gap: today the only way to hear about a room is
-- to already follow the host (live_invites, migration 036), so a one-off
-- scheduled screening is invisible to everyone else.
--
-- This migration only persists INTENT. Delivery reuses the existing Resend +
-- cron path (see 043_dm_email_notifications.sql) and is wired separately, so
-- `notified_at` starts null and is stamped by that job.
-- ---------------------------------------------------------------------------
create table if not exists public.space_reminders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  -- One reminder per person per room; the bell is a toggle, not a counter.
  unique (space_id, user_id)
);

-- The send job's query: unsent reminders for rooms about to start.
create index if not exists space_reminders_pending_idx
  on public.space_reminders (space_id)
  where notified_at is null;

-- A member's own bell state, for rendering the discover list.
create index if not exists space_reminders_user_idx
  on public.space_reminders (user_id, space_id);

alter table public.space_reminders enable row level security;

-- A reminder is private to the person who set it. Nobody else needs to know
-- who's planning to show up, and exposing it would leak attendance intent.
drop policy if exists "space_reminders_owner_read" on public.space_reminders;
create policy "space_reminders_owner_read"
  on public.space_reminders for select
  using (auth.uid() = user_id);

drop policy if exists "space_reminders_owner_insert" on public.space_reminders;
create policy "space_reminders_owner_insert"
  on public.space_reminders for insert
  with check (auth.uid() = user_id);

drop policy if exists "space_reminders_owner_delete" on public.space_reminders;
create policy "space_reminders_owner_delete"
  on public.space_reminders for delete
  using (auth.uid() = user_id);

comment on table public.space_reminders is
  'Per-member "notify me when this starts" intent for scheduled rooms, set from the MM Cinema discover screen bell. Delivery runs on the existing Resend/cron path.';
