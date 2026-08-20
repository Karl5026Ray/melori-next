-- 051_room_playback_state.sql
--
-- Host-authoritative playback state for MM Cinema watch parties.
--
-- THE MODEL: there is exactly one row per Cinema room and only the host may
-- write it. Guests never push their position — they read this row and correct
-- themselves toward it. That is what makes "everyone is watching the same
-- frame" true even when a guest pauses, buffers, or joins 20 minutes late.
--
-- WHY A TABLE AND NOT JUST REALTIME BROADCAST: a broadcast-only design loses
-- the state the moment it's sent. Someone who joins after the host pressed
-- play would sit on a black screen until the next event. Persisting the state
-- means a late joiner reads one row and lands in the right place immediately.
-- Realtime is the transport; this table is the truth.
--
-- WHY POSITION IS NOT A LIVE COUNTER: `position_seconds` is a snapshot taken
-- AT `updated_at`. Readers extrapolate:
--
--     target = position_seconds + (is_playing ? (now - updated_at) : 0)
--
-- So a playing room needs no write at all to stay correct — the row stays
-- accurate as time passes. Writes only happen when intent changes (play,
-- pause, seek, source) plus a slow heartbeat to bound clock drift. This is the
-- difference between a few writes a minute and a write every tick.

create table if not exists public.room_playback_state (
  -- PK is the space id: one playback state per room, enforced structurally
  -- rather than by convention. Cascades so ending a room cleans this up.
  space_id uuid primary key references public.spaces(id) on delete cascade,

  -- 'url'     = a direct file the browser can play natively (mp4, or HLS on
  --             Safari). This is the only type v1 implements.
  -- 'youtube' = reserved. The column exists now so adding the YouTube IFrame
  --             adapter later is a client change, not a migration + backfill.
  source_type text not null default 'url'
    check (source_type in ('url', 'youtube')),
  source_url text,

  -- Snapshot position at `updated_at`, NOT a live clock. See the note above.
  -- Numeric, not integer: sub-second precision is the whole point, and float
  -- drift on a value that gets repeatedly read and rewritten is avoidable.
  position_seconds numeric(12, 3) not null default 0
    check (position_seconds >= 0),

  -- Null until the host's player reports metadata. Used to clamp seeks and to
  -- stop extrapolating past the end of the file.
  duration_seconds numeric(12, 3)
    check (duration_seconds is null or duration_seconds >= 0),

  is_playing boolean not null default false,

  -- Who last wrote this. Kept for moderation and debugging: if a room desyncs,
  -- the first question is always "who moved it".
  updated_by uuid references public.profiles(id) on delete set null,

  -- Written with now() SERVER-SIDE on every update (see trigger). Readers use
  -- it as the extrapolation epoch, so it must never come from a client clock.
  updated_at timestamptz not null default now()
);

-- Force `updated_at` to the database clock on every write.
--
-- This is load-bearing, not hygiene. Guests extrapolate from `updated_at`, so
-- if a host's machine had a skewed clock and supplied this value, every guest
-- in the room would be offset by that skew. Stamping it server-side means all
-- readers share one authoritative epoch.
-- `set search_path = ''` pins resolution so a role with a hostile search_path
-- cannot shadow anything this function calls. Safe here because the body only
-- uses now(), which lives in pg_catalog and is always resolvable.
create or replace function public.touch_room_playback_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists room_playback_state_touch on public.room_playback_state;
create trigger room_playback_state_touch
  before insert or update on public.room_playback_state
  for each row execute function public.touch_room_playback_state();

alter table public.room_playback_state enable row level security;

-- Reads are open to anyone who can see the room. Playback position is not
-- sensitive, and the discover screen and late joiners both need it.
drop policy if exists "room_playback_state_read" on public.room_playback_state;
create policy "room_playback_state_read"
  on public.room_playback_state for select
  using (true);

-- No client-side write policy on purpose. All writes go through the
-- /playback route on the service role, which verifies the caller is the room's
-- host. A permissive RLS write policy here would be a second, weaker path to
-- the same privilege — any guest could hijack the screen.

comment on table public.room_playback_state is
  'Host-authoritative playback position for MM Cinema rooms. One row per space. position_seconds is a snapshot at updated_at; readers extrapolate forward while is_playing. Writes are service-role only, host-verified in the /playback route.';

-- Realtime delivery. Guests subscribe to postgres_changes on this table
-- filtered by space_id, so a host action reaches the room in one hop.
-- Guarded: `alter publication ... add table` throws if the table is already a
-- member, which would abort an otherwise idempotent re-run of this migration.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_playback_state'
  ) then
    alter publication supabase_realtime add table public.room_playback_state;
  end if;
end $$;

-- REPLICA IDENTITY FULL so the realtime payload carries the whole row. Without
-- it Postgres only ships the primary key for updates, and every guest would
-- have to round-trip a SELECT on each play/pause — turning a one-hop sync into
-- a thundering herd against the database.
alter table public.room_playback_state replica identity full;
