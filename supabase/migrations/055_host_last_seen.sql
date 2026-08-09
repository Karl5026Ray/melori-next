-- 055_host_last_seen.sql
--
-- NOTE: this file was renumbered from 048_host_last_seen.sql. It was already
-- applied to production BEFORE the renumbering, under the recorded migration
-- name "host_last_seen" (version 20260804041503) -- see issue #279. Renaming
-- the file does not re-run it: Supabase's migration ledger keys on the
-- recorded version string, not the filename, so this rename is safe and is a
-- no-op against the already-applied database. This file is kept (rather than
-- deleted) so a fresh database built from this repo still gets the column.
--
-- The number 048 was reused by two files at once (this one and
-- 048_single_price_floor_199.sql, which applied first and kept 048). This
-- file was moved to the next free number, 055, per issue #279. See
-- scripts/migration-prefix.test.ts for the guard test that now prevents a
-- third collision.
--
-- Presence for the abandonment reaper (see src/lib/endRoom.ts).
--
-- Why this column is needed:
-- spaces.last_activity_at (005_mm_social_clubhouse.sql) is bumped by the
-- room heartbeat on behalf of ANY joined participant. It is therefore
-- useless for detecting whether the host specifically has vanished.
--
-- profiles.last_seen_at (032_member_presence.sql) is site-wide presence and
-- is only bumped while the member has the Mirror page open, which a host
-- sitting in their own room will not do. Not usable for this either.
--
-- So this migration adds a dedicated timestamp for it.
alter table public.spaces
add column if not exists host_last_seen_at timestamptz;

comment on column public.spaces.host_last_seen_at is
'Last time the current host of this room was confirmed present. Used by the abandonment reaper to end a room whose host has been gone too long, without a cron job. NULL means never recorded and is treated as not yet abandoned until a value is set.';
