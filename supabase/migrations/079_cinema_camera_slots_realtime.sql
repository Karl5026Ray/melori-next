-- Fix: Cinema camera-slot changes never reached other participants.
--
-- RoomScreen.tsx has subscribed to postgres_changes on public.cinema_camera_slots
-- (channel `cinema_slots:<spaceId>`) since the feature shipped in migration 057,
-- but that subscription has been silently dead the whole time: the table was
-- never added to the supabase_realtime publication, so Postgres never published
-- a single change for it. A read policy was added later
-- (cinema_camera_slots_rls_read_policy), which was necessary but not sufficient —
-- without publication membership there is nothing for RLS to filter.
--
-- The visible symptom: a host assigns someone a live box and nobody else in the
-- room sees it until they reload. The slot was durable and correct in the
-- database; only the delivery was missing.
--
-- This migration adds the two missing pieces, matching room_playback_state
-- (migration 051), which is the working precedent in this codebase.

-- Guarded so re-running the migration is idempotent: `alter publication ...
-- add table` throws if the table is already a member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cinema_camera_slots'
  ) then
    alter publication supabase_realtime add table public.cinema_camera_slots;
  end if;
end $$;

-- REPLICA IDENTITY FULL so a released slot carries enough of the old row for
-- subscribers to know WHICH slot was freed. With the default identity a DELETE
-- ships only the primary key, and while (space_id, slot) is enough to locate
-- the tile, the user_id needed to clear that participant's camera state is not
-- in the key — every client would have to re-query on every release.
alter table public.cinema_camera_slots replica identity full;
