-- 061_concert_battle_invitations.sql
--
-- APPEND-ONLY MIGRATION. PR 1 created the Concert battle aggregate and its
-- first invite RPCs. This migration tightens the invitation state machine for
-- PR 2: one explicit pending invitation, locked cancellation/expiry, and
-- idempotent recipient responses. Do not edit migration 060 after application.

-- An initiator must explicitly cancel a live pending invitation before choosing
-- another person. An expired invitation is resolved under the same room lock
-- before a replacement can be created.
create or replace function public.invite_concert_opponent(
  p_space_id uuid,
  p_initiator_id uuid,
  p_recipient_id uuid,
  p_expires_at timestamptz default now() + interval '2 hours'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.concert_battles%rowtype;
  v_space public.spaces%rowtype;
  v_pending public.concert_battle_invites%rowtype;
  v_recipient public.profiles%rowtype;
  v_invite_id uuid;
begin
  if p_initiator_id = p_recipient_id then
    raise exception 'concert_battle_self_invite';
  end if;
  if p_expires_at <= now() then
    raise exception 'concert_battle_invite_expired';
  end if;

  -- Lock order is always envelope, aggregate, invite. It serializes
  -- invite/cancel/accept so slot 2 cannot be replaced by a concurrent request.
  select * into v_space from public.spaces where id = p_space_id for update;
  if not found
     or v_space.room_format is distinct from 'versus_battle'
     or v_space.status <> 'live' then
    raise exception 'concert_battle_not_found';
  end if;

  select * into v_battle
    from public.concert_battles
   where space_id = p_space_id
   for update;
  if not found or v_battle.initiator_id <> p_initiator_id then
    raise exception 'concert_battle_initiator_required';
  end if;
  if v_battle.opponent_id is not null
     or v_battle.status not in ('selecting_opponent', 'invited') then
    raise exception 'concert_battle_opponent_locked';
  end if;

  select * into v_recipient
    from public.profiles
   where id = p_recipient_id;
  if not found then
    raise exception 'concert_battle_recipient_not_found';
  end if;
  if v_recipient.deleted_at is not null
     or (v_recipient.status is not null and v_recipient.status <> 'active') then
    raise exception 'concert_battle_recipient_inactive';
  end if;
  if exists (
    select 1 from public.member_blocks b
     where (b.blocker_id = p_initiator_id and b.blocked_id = p_recipient_id)
        or (b.blocker_id = p_recipient_id and b.blocked_id = p_initiator_id)
  ) then
    raise exception 'concert_battle_recipient_blocked';
  end if;
  if exists (
    select 1 from public.space_bans b
     where b.space_id = p_space_id and b.user_id = p_recipient_id
  ) then
    raise exception 'concert_battle_recipient_banned';
  end if;

  select * into v_pending
    from public.concert_battle_invites
   where space_id = p_space_id and status = 'pending'
   for update;

  if found and v_pending.expires_at <= now() then
    update public.concert_battle_invites
       set status = 'expired'
     where id = v_pending.id;
    -- Expiring an old row may happen after the room has ended or after a
    -- later terminal transition. It must not resurrect opponent selection.
    if v_space.room_format = 'versus_battle'
       and v_space.status = 'live'
       and v_battle.opponent_id is null
       and v_battle.status = 'invited' then
      update public.concert_battles
         set status = 'selecting_opponent',
             version = version + 1
       where space_id = p_space_id
         and opponent_id is null
         and status = 'invited';
    end if;
    v_pending := null;
  end if;

  if v_pending.id is not null then
    -- A retry of the same send intent is harmless and never creates another
    -- pending row. A different candidate requires the explicit cancel endpoint.
    if v_pending.recipient_id = p_recipient_id then
      return v_pending.id;
    end if;
    raise exception 'concert_battle_invite_pending';
  end if;

  insert into public.concert_battle_invites (
    space_id, sender_id, recipient_id, status, expires_at
  ) values (
    p_space_id, p_initiator_id, p_recipient_id, 'pending', p_expires_at
  )
  returning id into v_invite_id;

  update public.concert_battles
     set status = 'invited',
         version = version + 1
   where space_id = p_space_id;

  return v_invite_id;
end;
$$;

-- Only the immutable initiator can cancel a pending invitation. The function
-- is deliberately idempotent: no active invite is a successful no-op.
create or replace function public.cancel_concert_battle_invite(
  p_space_id uuid,
  p_initiator_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space public.spaces%rowtype;
  v_battle public.concert_battles%rowtype;
  v_invite public.concert_battle_invites%rowtype;
begin
  select * into v_space from public.spaces where id = p_space_id for update;
  if not found then
    raise exception 'concert_battle_not_found';
  end if;

  select * into v_battle
    from public.concert_battles
   where space_id = p_space_id
   for update;
  if not found or v_battle.initiator_id <> p_initiator_id then
    raise exception 'concert_battle_initiator_required';
  end if;

  select * into v_invite
    from public.concert_battle_invites
   where space_id = p_space_id and status = 'pending'
   for update;
  if not found then
    return null;
  end if;

  if v_invite.expires_at <= now() then
    update public.concert_battle_invites set status = 'expired' where id = v_invite.id;
  else
    update public.concert_battle_invites
       set status = 'cancelled', responded_at = now()
     where id = v_invite.id;
  end if;

  -- A stale cancellation may clear the invite row, but it must never turn an
  -- ended/non-Concert envelope or terminal battle back into selection.
  if v_space.room_format = 'versus_battle'
     and v_space.status = 'live'
     and v_battle.opponent_id is null
     and v_battle.status = 'invited' then
    update public.concert_battles
       set status = 'selecting_opponent',
           version = version + 1
     where space_id = p_space_id
       and opponent_id is null
       and status = 'invited';
  end if;

  return v_invite.id;
end;
$$;

-- Expiry is a durable state transition, not a client-only countdown. This is
-- called from authenticated inbox/state reads and from invite creation; a
-- scheduler may safely call it later because it is idempotent.
create or replace function public.expire_concert_battle_invites_for_recipient(
  p_recipient_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_space_id uuid;
  v_space public.spaces%rowtype;
  v_battle public.concert_battles%rowtype;
  v_count integer := 0;
begin
  -- Every worker visits a recipient's expired rooms in one order. All nested
  -- mutations then retain the global envelope -> battle -> invite lock order,
  -- which prevents two inbox reconciliations from taking the same rooms in
  -- opposite order.
  for v_invite_id, v_space_id in
    select id, space_id
      from public.concert_battle_invites
     where recipient_id = p_recipient_id
       and status = 'pending'
       and expires_at <= now()
     order by space_id, id
  loop
    select * into v_space from public.spaces where id = v_space_id for update;
    if not found then
      continue;
    end if;
    select * into v_battle
      from public.concert_battles
     where space_id = v_space_id
     for update;
    update public.concert_battle_invites
       set status = 'expired'
     where id = v_invite_id
       and status = 'pending'
       and expires_at <= now();
    if found then
      if v_space.room_format = 'versus_battle'
         and v_space.status = 'live'
         and v_battle.opponent_id is null
         and v_battle.status = 'invited' then
        update public.concert_battles
           set status = 'selecting_opponent',
               version = version + 1
         where space_id = v_space_id
           and opponent_id is null
           and status = 'invited';
      end if;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- The battle screen also needs to reconcile an expired outgoing invitation
-- without waiting for the recipient to open their inbox.
create or replace function public.expire_concert_battle_invite_for_space(
  p_space_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space public.spaces%rowtype;
  v_battle public.concert_battles%rowtype;
  v_invite public.concert_battle_invites%rowtype;
begin
  select * into v_space from public.spaces where id = p_space_id for update;
  if not found then
    return false;
  end if;
  select * into v_battle
    from public.concert_battles
   where space_id = p_space_id
   for update;
  select * into v_invite
    from public.concert_battle_invites
   where space_id = p_space_id
     and status = 'pending'
   for update;
  if not found or v_invite.expires_at > now() then
    return false;
  end if;
  update public.concert_battle_invites set status = 'expired' where id = v_invite.id;
  if v_space.room_format = 'versus_battle'
     and v_space.status = 'live'
     and v_battle.opponent_id is null
     and v_battle.status = 'invited' then
    update public.concert_battles
       set status = 'selecting_opponent',
           version = version + 1
     where space_id = p_space_id
       and opponent_id is null
       and status = 'invited';
  end if;
  return true;
end;
$$;

-- Recipient responses are idempotent for their own already-completed action.
-- An accept never takes an opponent id, slot, or space id from the browser.
-- This replaces the UUID-returning foundation RPC with an explicit outcome
-- payload. In particular, expiry must commit its row/battle transition before
-- the API renders a conflict; raising after that update would roll it back.
drop function if exists public.respond_concert_battle_invite(uuid, uuid, text);
create function public.respond_concert_battle_invite(
  p_invite_id uuid,
  p_recipient_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_space public.spaces%rowtype;
  v_invite public.concert_battle_invites%rowtype;
  v_battle public.concert_battles%rowtype;
  v_recipient public.profiles%rowtype;
begin
  if p_action not in ('accept', 'decline') then
    raise exception 'concert_battle_invite_action_invalid';
  end if;

  select space_id into v_space_id
    from public.concert_battle_invites
   where id = p_invite_id;
  if not found then
    raise exception 'concert_battle_invite_not_found';
  end if;

  -- Keep this lock order aligned with every other invite transition:
  -- envelope -> battle -> invite.
  select * into v_space from public.spaces where id = v_space_id for update;
  if not found then
    raise exception 'concert_battle_not_found';
  end if;
  select * into v_battle
    from public.concert_battles
   where space_id = v_space_id
   for update;
  select * into v_invite
    from public.concert_battle_invites
   where id = p_invite_id
   for update;

  if not found or v_invite.recipient_id <> p_recipient_id then
    raise exception 'concert_battle_invite_recipient_required';
  end if;

  if v_invite.status = 'accepted'
     and p_action = 'accept'
     and v_battle.opponent_id = p_recipient_id then
    return jsonb_build_object('space_id', v_space_id, 'outcome', 'accepted');
  end if;
  if v_invite.status = 'declined' and p_action = 'decline' then
    return jsonb_build_object('space_id', v_space_id, 'outcome', 'declined');
  end if;
  -- An expired response retry reports the same committed outcome. It never
  -- recreates a pending row or rewrites a terminal battle state.
  if v_invite.status = 'expired' then
    return jsonb_build_object('space_id', v_space_id, 'outcome', 'expired');
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'concert_battle_invite_not_pending';
  end if;

  if v_invite.expires_at <= now() then
    update public.concert_battle_invites set status = 'expired' where id = v_invite.id;
    if v_space.room_format = 'versus_battle'
       and v_space.status = 'live'
       and v_battle.opponent_id is null
       and v_battle.status = 'invited' then
      update public.concert_battles
         set status = 'selecting_opponent',
             version = version + 1
       where space_id = v_space_id
         and opponent_id is null
         and status = 'invited';
    end if;
    -- Return rather than raise so the expired invite leaves the partial pending
    -- index and the selecting-opponent transition commits atomically.
    return jsonb_build_object('space_id', v_space_id, 'outcome', 'expired');
  end if;
  if v_battle.opponent_id is not null then
    raise exception 'concert_battle_opponent_locked';
  end if;

  if p_action = 'decline' then
    update public.concert_battle_invites
       set status = 'declined', responded_at = now()
     where id = v_invite.id;
    if v_space.room_format = 'versus_battle'
       and v_space.status = 'live'
       and v_battle.opponent_id is null
       and v_battle.status = 'invited' then
      update public.concert_battles
         set status = 'selecting_opponent',
             version = version + 1
       where space_id = v_space_id
         and opponent_id is null
         and status = 'invited';
    end if;
    return jsonb_build_object('space_id', v_space_id, 'outcome', 'declined');
  end if;

  -- Eligibility is checked again at the irreversible acceptance transition:
  -- a block, account deactivation, or room ban can happen after the invite was
  -- sent. An accepted slot is never replaced, but a pending row may not bypass
  -- the current safety policy just because it was once eligible.
  select * into v_recipient from public.profiles where id = p_recipient_id;
  if not found
     or v_recipient.deleted_at is not null
     or (v_recipient.status is not null and v_recipient.status <> 'active') then
    raise exception 'concert_battle_recipient_inactive';
  end if;
  if exists (
    select 1 from public.member_blocks b
     where (b.blocker_id = v_battle.initiator_id and b.blocked_id = p_recipient_id)
        or (b.blocker_id = p_recipient_id and b.blocked_id = v_battle.initiator_id)
  ) then
    raise exception 'concert_battle_recipient_blocked';
  end if;
  if exists (
    select 1 from public.space_bans b
     where b.space_id = v_space_id and b.user_id = p_recipient_id
  ) then
    raise exception 'concert_battle_recipient_banned';
  end if;

  -- This is deliberately after the accepted retry fast path above. A retry by
  -- the already accepted recipient remains a no-op even after the Concert
  -- ends, while a first acceptance may only fix slot 2 in a live Concert that
  -- is still awaiting this invitation.
  if v_space.room_format is distinct from 'versus_battle'
     or v_space.status <> 'live'
     or v_battle.status <> 'invited'
     or v_battle.opponent_id is not null then
    raise exception 'concert_battle_invite_not_pending';
  end if;

  update public.concert_battle_invites
     set status = 'accepted', responded_at = now()
   where id = v_invite.id;
  insert into public.space_participants (
    space_id, user_id, role, is_muted, left_at, has_raised_hand
  ) values (
    v_space_id, p_recipient_id, 'speaker', false, null, false
  )
  on conflict (space_id, user_id) do update
    set role = 'speaker',
        is_muted = false,
        left_at = null,
        has_raised_hand = false;
  update public.concert_battles
     set opponent_id = p_recipient_id,
         status = 'ready',
         version = version + 1
   where space_id = v_space_id;
  return jsonb_build_object('space_id', v_space_id, 'outcome', 'accepted');
end;
$$;

revoke all on function public.invite_concert_opponent(uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.cancel_concert_battle_invite(uuid, uuid) from public;
revoke all on function public.expire_concert_battle_invites_for_recipient(uuid) from public;
revoke all on function public.expire_concert_battle_invite_for_space(uuid) from public;
revoke all on function public.respond_concert_battle_invite(uuid, uuid, text) from public;
grant execute on function public.invite_concert_opponent(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.cancel_concert_battle_invite(uuid, uuid) to service_role;
grant execute on function public.expire_concert_battle_invites_for_recipient(uuid) to service_role;
grant execute on function public.expire_concert_battle_invite_for_space(uuid) to service_role;
grant execute on function public.respond_concert_battle_invite(uuid, uuid, text) to service_role;

comment on function public.cancel_concert_battle_invite(uuid, uuid) is
  'Locked, initiator-only Concert invite cancellation. Pending invite replacement requires this explicit transition.';
comment on function public.expire_concert_battle_invites_for_recipient(uuid) is
  'Locked and idempotent durable expiry for a recipient inbox; safe to call during authenticated reads.';
