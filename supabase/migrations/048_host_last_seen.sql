-- 048_host_last_seen.sql
-- Host-specific presence for the abandonment reaper (see src/lib/endRoom.ts).
--
-- Why this column is needed:
-- `spaces.last_activity_at` (005_mm_social_clubhouse.sql) is bumped by the
-- room heartbeat (POST /api/social/spaces/[spaceId]/heartbeat) on behalf of
-- ANY joined participant, host or not. It is therefore useless for detecting
-- "has the HOST specifically vanished" — a single lingering listener keeps it
-- fresh forever even if the host's connection died.
--
-- `profiles.last_seen_at` (032_member_presence.sql) is host-agnostic site-wide
-- presence, and worse, it is only bumped while the member has the Melori
-- Mirror page open (see OnlineNowRow.tsx) — a host sitting inside their own
-- live room does NOT bump it at all unless they separately have the Mirror
-- open in another tab. It is not a usable signal for this purpose either.
--
-- Neither existing timestamp tracks "is the host still around" in a way that
-- is safe to reap on, so this migration adds a dedicated one.
alter table public.spaces
  add column if not exists host_last_seen_at timestamptz;

comment on column public.spaces.host_last_seen_at is
  'Last time the CURRENT host of this room was confirmed present (room heartbeat call made by host_id, or room creation/go-live). Used by the lazy abandonment reaper (endRoom.ts) to end a room whose host has been gone longer than HOST_GRACE_PERIOD_SECONDS, without a cron job. NULL means never recorded (e.g. rooms created before this column existed) and is treated as "not yet abandoned" until a value is set.';
