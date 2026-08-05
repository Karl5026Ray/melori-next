-- 053_participant_badge_drift_repair.sql
--
-- SCHEMA DRIFT REPAIR: production is missing space_participants.badge.
--
-- Migration 017 (017_host_on_stage_and_badges.sql) introduced the participant
-- badge column ('cohost' | 'mod' | 'vip'), but it never landed on the live
-- database — a live API smoke test of the room slot flows found the column
-- absent while everything from 028 onward (stage_requested_at, the queue
-- trigger and index) is present. Three shipped code paths assume the column
-- exists, and all three fail silently or loudly because of it:
--
--   1. public.promote_next_host() (029) filters candidates on
--      `badge in ('mod','cohost')`. The whole function raises 42703, so
--      promoteHostOnLeave() swallows the error and reports 'not-found'.
--      RESULT: when a host leaves a live room nobody is promoted and the room
--      stays 'live' forever with a departed host — verified in production.
--
--   2. /api/livekit-token selects "role, left_at, host_muted, badge". The
--      query errors, `participant` comes back null, and every non-host falls
--      through to the audience branch.
--      RESULT: a host-promoted speaker is issued canPublish=false and cannot
--      go on camera/mic in a LiveKit (MM Faces) room — verified in production.
--      (MM Spaces / MM Cinema use /api/agora-token, which does not select
--      badge, so audio there was unaffected.)
--
--   3. PATCH /api/social/spaces/[spaceId]/participants/[userId] with
--      { badge: "mod" } returns 500 "Could not find the 'badge' column of
--      'space_participants' in the schema cache", and isModeratorRow()'s
--      lookup errors for every caller.
--      RESULT: co-hosts/moderators cannot be appointed and cannot moderate.
--
-- This migration re-applies ONLY the column + its check constraint from 017.
-- 017's enforce_host_on_stage() trigger is deliberately NOT re-applied here:
-- it force-resets is_muted/host_muted to false on every write to the host's
-- row, which would silently undo a host's own mute, and the room code has
-- since moved to setting role='host' explicitly on join. Repairing the badge
-- drift is the narrow fix the broken flows actually need.
--
-- Both statements are idempotent, so this is a no-op on any environment where
-- 017 did apply cleanly.

alter table public.space_participants
  add column if not exists badge text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'space_participants_badge_check'
       and conrelid = 'public.space_participants'::regclass
  ) then
    alter table public.space_participants
      add constraint space_participants_badge_check
      check (badge is null or badge in ('cohost','mod','vip'));
  end if;
end $$;

-- Moderator lookups are per-room and always filter to people still present.
create index if not exists space_participants_badge_idx
  on public.space_participants (space_id, badge)
  where badge is not null and left_at is null;

comment on column public.space_participants.badge is
  'Trusted-helper badge: cohost | mod | vip (NULL = none). badge in (mod,cohost) '
  'means moderator: may approve stage requests, mute and demote, and is the first '
  'candidate promote_next_host() considers when the host leaves.';
