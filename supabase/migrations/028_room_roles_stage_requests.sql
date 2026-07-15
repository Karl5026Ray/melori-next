-- 028_room_roles_stage_requests.sql
-- Server-authoritative stage vs audience role model for ALL live room types
-- (MM Spaces audio + MM Faces video). See src/lib/livekitServer.ts and the
-- /api/social/spaces/[spaceId]/participants/[userId] PATCH endpoint, which are
-- the ACTUAL source of truth for LiveKit publish permissions (canPublish). This
-- migration only persists the *social* role + request queue so state survives
-- reconnects; it never grants media permission by itself.
--
-- Role model
-- ----------
--   host      — space creator; always on stage, can moderate.
--   moderator — trusted helper (space_participants.badge in ('mod','cohost'));
--               can approve stage requests + invite/mute/demote, like a host.
--   speaker   — on stage (canPublish=true, set server-side after approval).
--   audience  — listener/viewer (canPublish=false). The DEFAULT for everyone
--               who is not host/moderator.
--
-- Getting on stage happens two ways, both server-verified:
--   (a) audience raises hand (has_raised_hand=true, ordered by
--       stage_requested_at) → host/mod approves → role becomes 'speaker'.
--   (b) host/mod directly invites → role becomes 'speaker'.

-- ---------------------------------------------------------------------------
-- Ordered raised-hand queue.
-- stage_requested_at records WHEN the current hand was raised so hosts can work
-- the queue oldest-first. A trigger keeps it in sync with has_raised_hand so
-- both the direct-supabase client write and the server path stay consistent.
-- ---------------------------------------------------------------------------
alter table public.space_participants
  add column if not exists stage_requested_at timestamptz;

create or replace function public.sync_stage_requested_at()
returns trigger
language plpgsql
as $$
begin
  -- Hand just went up → stamp the request time. Hand lowered / promoted →
  -- clear it. Leaving it unchanged while has_raised_hand stays true preserves
  -- original queue order across other row updates (mute, speaking, etc.).
  if new.has_raised_hand is true
     and (old.has_raised_hand is distinct from true) then
    new.stage_requested_at := now();
  elsif new.has_raised_hand is not true then
    new.stage_requested_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_stage_requested_at on public.space_participants;
create trigger trg_sync_stage_requested_at
  before insert or update on public.space_participants
  for each row execute function public.sync_stage_requested_at();

-- Backfill: any hands currently raised get a request time so they sort sanely.
update public.space_participants
   set stage_requested_at = coalesce(stage_requested_at, joined_at, now())
 where has_raised_hand is true
   and stage_requested_at is null;

-- Fast lookup of the pending queue for a room.
create index if not exists space_participants_stage_queue_idx
  on public.space_participants (space_id, stage_requested_at)
  where has_raised_hand is true and left_at is null;

-- ---------------------------------------------------------------------------
-- Moderator badge: the existing space_participants.badge check already allows
-- ('cohost','mod','vip') (migration 017). Moderators are badge in
-- ('mod','cohost'); no schema change needed — documented here for clarity.
-- ---------------------------------------------------------------------------
