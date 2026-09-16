-- RECOVERED 078_cinema_talk_mode
--
-- This file was missing from supabase/migrations/ while the migration was
-- already applied to production. The SQL below is the exact text recorded in
-- supabase_migrations.schema_migrations for version 20260915122549, recovered
-- verbatim -- it is not a reconstruction from the live schema.
--
-- Already applied. Do not re-apply. See scripts/migration-prefix.test.ts for
-- the gap check that now makes this class of drift fail CI.

-- MM Cinema: durable, host-authoritative talk mode.
--
-- Talk mode controls who can be HEARD in a Cinema room. It sits alongside the
-- existing host/speaker/audience roles in roomMediaPolicy.ts rather than
-- replacing them:
--   silent       - nobody on mic, including the host. Reactions only.
--   intermission - open mic for the host and anyone approved on stage.
--   commentary   - host mic only; everyone else listens.
--
-- WHY A TABLE AND NOT A COLUMN ON spaces
-- The `spaces` row is read on nearly every request in the app and is already
-- published to supabase_realtime with the DEFAULT replica identity. Adding a
-- hot, frequently-updated column to it would mean either flipping that hot
-- table to REPLICA IDENTITY FULL (widening WAL for every space write in the
-- product) or accepting an unreliable realtime payload. A dedicated one-row-
-- per-room table keeps the cost where the feature is, and mirrors the
-- room_playback_state precedent (migration 051) exactly.
--
-- Realtime is the transport; this table is the truth. A guest who reloads,
-- reconnects, or joins late reads the current mode here rather than waiting to
-- observe the next change.

create table if not exists public.room_talk_state (
  space_id   uuid primary key references public.spaces(id) on delete cascade,
  talk_mode  text not null default 'intermission'
             check (talk_mode in ('silent', 'intermission', 'commentary')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.room_talk_state enable row level security;

-- Readable by anyone who can see the room. The mode is not a secret: it is
-- rendered in the room UI for every participant, and guests must be able to
-- read it to know whether their mic is live.
drop policy if exists "room_talk_state_read" on public.room_talk_state;
create policy "room_talk_state_read"
  on public.room_talk_state for select
  using (true);

-- No client-side write policy on purpose. All writes go through the
-- /talk-mode route on the service role, which verifies the caller is the
-- room's host or a moderator. A permissive RLS write policy here would be a
-- second, weaker path to the same privilege - any guest could silence a room
-- or open every mic in it.

comment on table public.room_talk_state is
  'Host-authoritative talk mode for MM Cinema rooms. One row per space. Governs who may be heard; camera slots and stage roles are decided separately. Writes are service-role only, host/moderator-verified in the /talk-mode route.';

-- Realtime delivery. Participants subscribe to postgres_changes on this table
-- filtered by space_id, so a mode change reaches the room in one hop.
-- Guarded: `alter publication ... add table` throws if the table is already a
-- member, which would abort an otherwise idempotent re-run of this migration.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_talk_state'
  ) then
    alter publication supabase_realtime add table public.room_talk_state;
  end if;
end $$;

-- REPLICA IDENTITY FULL so the realtime payload carries the whole row. Without
-- it Postgres ships only the primary key on update, and every participant
-- would have to round-trip a SELECT on each mode change.
alter table public.room_talk_state replica identity full;
