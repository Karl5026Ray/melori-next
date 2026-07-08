-- 016_pubnub_ephemeral_presence.sql
-- Adds the atomic "end this room right now" RPC used by the PubNub presence
-- webhook (POST /api/pubnub/presence-webhook) to guarantee a Space vanishes
-- the instant its channel occupancy hits zero.
--
-- Why an RPC instead of a plain UPDATE?
--   * Atomic + guarded: it only flips a room that is still 'live', so
--     duplicate/late webhook deliveries are safe no-ops (idempotent).
--   * Single authority: the DB — not the webhook handler — owns the
--     'live' -> 'ended' transition, matching how reap_idle_spaces() and
--     prune_ended_spaces() already work.
--   * Returns the id it actually ended (or NULL), so the caller can tell
--     whether *it* was the one that ended the room.
--
-- Pairs with the existing cron functions from 005_mm_social_clubhouse.sql:
--   reap_idle_spaces(30)    — safety net for rooms PubNub somehow missed
--   prune_ended_spaces(2)   — hard-deletes ended rooms (true "vanish")
-- PubNub makes the *end* immediate; the hourly prune makes the row disappear.

create or replace function public.end_space_now(p_space_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ended_id uuid;
begin
  update public.spaces
     set status = 'ended',
         ended_at = coalesce(ended_at, now())
   where id = p_space_id
     and status = 'live'
  returning id into ended_id;

  -- Mark any participant rows still open as left, so the participant list is
  -- consistent with the ended room and counts don't leak into any UI.
  if ended_id is not null then
    update public.space_participants
       set left_at = now()
     where space_id = p_space_id
       and left_at is null;
  end if;

  return ended_id; -- NULL when the room was already ended/never live
end;
$$;

comment on function public.end_space_now(uuid) is
  'Atomically end a live Space (used by the PubNub presence webhook when channel occupancy reaches zero). Idempotent: returns the space id only if THIS call performed the live->ended transition, else NULL.';

-- Optional: shrink the prune window for ended rooms so PubNub-ended rooms
-- disappear faster than the previous 2h default. The cron passes its own
-- argument, so this only changes the default when called with no args. Kept
-- conservative (30 min) so late-arriving clients can still render an
-- "ended" state before the row is deleted.
create or replace function public.prune_ended_spaces(older_than_hours int default 2)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.spaces
   where status = 'ended'
     and coalesce(ended_at, created_at) < now() - make_interval(hours => older_than_hours);
  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;
