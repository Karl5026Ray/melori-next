-- 060_concert_battle_domain.sql
--
-- APPEND-ONLY MIGRATION: do not edit a migration after it is applied. Add a
-- later numbered migration for every Concert Battle schema or policy change.
--
-- Concert Battles use a normal `spaces` row as the durable room envelope, but
-- their two performer identities and lifecycle live in this separate aggregate.
-- This keeps generic Spaces host/speaker promotion from becoming battle truth.

create table if not exists public.concert_battles (
  space_id uuid primary key references public.spaces(id) on delete cascade,
  initiator_id uuid not null references public.profiles(id) on delete restrict,
  opponent_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'selecting_opponent' check (
    status in (
      'selecting_opponent',
      'invited',
      'ready',
      'round_active',
      'round_intermission',
      'completed',
      'cancelled',
      'expired',
      'forfeited'
    )
  ),
  current_round smallint not null default 0 check (current_round between 0 and 3),
  regulation_rounds smallint not null default 3 check (regulation_rounds = 3),
  round_duration_seconds integer not null default 240
    check (round_duration_seconds = 240),
  phase_started_at timestamptz,
  phase_ends_at timestamptz,
  winner_id uuid references public.profiles(id) on delete restrict,
  completion_reason text,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint concert_battles_distinct_competitors
    check (opponent_id is null or opponent_id <> initiator_id),
  constraint concert_battles_winner_is_competitor
    check (winner_id is null or winner_id = initiator_id or winner_id = opponent_id),
  constraint concert_battles_completed_at_terminal
    check (
      completed_at is null
      or status in ('completed', 'cancelled', 'expired', 'forfeited')
    ),
  constraint concert_battles_active_phase_has_deadline
    check (
      status <> 'round_active'
      or (
        phase_started_at is not null
        and phase_ends_at is not null
        and phase_ends_at > phase_started_at
      )
    )
);

create index if not exists concert_battles_initiator_status_idx
  on public.concert_battles (initiator_id, status);
create index if not exists concert_battles_opponent_status_idx
  on public.concert_battles (opponent_id, status)
  where opponent_id is not null;

create table if not exists public.concert_battle_rounds (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.concert_battles(space_id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 4),
  state text not null default 'pending'
    check (state in ('pending', 'active', 'finalized', 'draw')),
  starts_at timestamptz,
  ends_at timestamptz,
  finalized_at timestamptz,
  winner_id uuid references public.profiles(id) on delete restrict,
  initiator_gift_count integer not null default 0 check (initiator_gift_count >= 0),
  opponent_gift_count integer not null default 0 check (opponent_gift_count >= 0),
  initiator_coins_total integer not null default 0 check (initiator_coins_total >= 0),
  opponent_coins_total integer not null default 0 check (opponent_coins_total >= 0),
  created_at timestamptz not null default now(),
  constraint concert_battle_rounds_unique_number unique (space_id, round_number),
  constraint concert_battle_rounds_active_has_window
    check (
      state <> 'active'
      or (starts_at is not null and ends_at is not null and ends_at > starts_at)
    ),
  constraint concert_battle_rounds_final_has_timestamp
    check (
      state not in ('finalized', 'draw')
      or finalized_at is not null
    )
);

create index if not exists concert_battle_rounds_active_idx
  on public.concert_battle_rounds (space_id, ends_at)
  where state = 'active';

create table if not exists public.concert_battle_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.concert_battles(space_id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint concert_battle_invites_no_self check (sender_id <> recipient_id),
  constraint concert_battle_invites_expire_after_creation
    check (expires_at > created_at),
  constraint concert_battle_invites_response_timestamp
    check (
      (status in ('pending', 'expired') and responded_at is null)
      or (status not in ('pending', 'expired') and responded_at is not null)
    )
);

create index if not exists concert_battle_invites_recipient_pending_idx
  on public.concert_battle_invites (recipient_id, expires_at, created_at desc)
  where status = 'pending';
create index if not exists concert_battle_invites_sender_idx
  on public.concert_battle_invites (sender_id, created_at desc);
create unique index if not exists concert_battle_invites_one_pending_per_battle
  on public.concert_battle_invites (space_id)
  where status = 'pending';
create unique index if not exists concert_battle_invites_one_accepted_per_battle
  on public.concert_battle_invites (space_id)
  where status = 'accepted';

alter table public.concert_battles enable row level security;
alter table public.concert_battle_rounds enable row level security;
alter table public.concert_battle_invites enable row level security;

-- Battle reads flow through authenticated server routes. There are deliberately
-- no client-table policies: anonymous/authenticated users cannot infer invitees,
-- unfinished scores, or immutable performer identities by querying these tables.
revoke all on table public.concert_battles from anon, authenticated;
revoke all on table public.concert_battle_rounds from anon, authenticated;
revoke all on table public.concert_battle_invites from anon, authenticated;
grant all on table public.concert_battles to service_role;
grant all on table public.concert_battle_rounds to service_role;
grant all on table public.concert_battle_invites to service_role;

create or replace function public.concert_battle_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists concert_battles_touch_updated_at on public.concert_battles;
create trigger concert_battles_touch_updated_at
before update on public.concert_battles
for each row execute function public.concert_battle_touch_updated_at();

-- Enforce the domain boundary even for a future service route that accidentally
-- writes a battle row directly. `opponent_id` may transition from NULL once,
-- but can never be reassigned or cleared. Slot 1 is always the space host.
create or replace function public.concert_battle_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_format text;
  v_host_id uuid;
begin
  select room_format, host_id
    into v_room_format, v_host_id
    from public.spaces
   where id = new.space_id;

  if not found or v_room_format is distinct from 'versus_battle' then
    raise exception 'concert battles require a versus_battle space';
  end if;
  if new.initiator_id <> v_host_id then
    raise exception 'concert battle initiator must remain the space host';
  end if;

  if tg_op = 'UPDATE' then
    if new.initiator_id <> old.initiator_id then
      raise exception 'concert battle initiator is immutable';
    end if;
    if old.opponent_id is not null
       and new.opponent_id is distinct from old.opponent_id then
      raise exception 'concert battle opponent is immutable';
    end if;
    if old.winner_id is not null and new.winner_id <> old.winner_id then
      raise exception 'concert battle winner is immutable';
    end if;
  end if;

  -- A second performer must be backed by the one accepted invitation for this
  -- battle. respond_concert_battle_invite marks that invite accepted before it
  -- assigns the immutable opponent identity.
  if new.opponent_id is not null
     and (tg_op = 'INSERT' or old.opponent_id is null) then
    if not exists (
      select 1
        from public.concert_battle_invites i
       where i.space_id = new.space_id
         and i.sender_id = new.initiator_id
         and i.recipient_id = new.opponent_id
         and i.status = 'accepted'
    ) then
      raise exception 'concert battle opponent requires an accepted invite';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists concert_battle_identity_guard_before_write
  on public.concert_battles;
create trigger concert_battle_identity_guard_before_write
before insert or update on public.concert_battles
for each row execute function public.concert_battle_identity_guard();

create or replace function public.concert_battle_round_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiator_id uuid;
  v_opponent_id uuid;
begin
  select initiator_id, opponent_id
    into v_initiator_id, v_opponent_id
    from public.concert_battles
   where space_id = new.space_id;

  if not found then
    raise exception 'concert battle round requires a battle';
  end if;
  if new.winner_id is not null
     and new.winner_id <> v_initiator_id
     and new.winner_id is distinct from v_opponent_id then
    raise exception 'concert battle round winner must be a competitor';
  end if;
  return new;
end;
$$;

drop trigger if exists concert_battle_round_identity_guard_before_write
  on public.concert_battle_rounds;
create trigger concert_battle_round_identity_guard_before_write
before insert or update on public.concert_battle_rounds
for each row execute function public.concert_battle_round_identity_guard();

create or replace function public.concert_battle_invite_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiator_id uuid;
  v_opponent_id uuid;
begin
  select initiator_id, opponent_id
    into v_initiator_id, v_opponent_id
    from public.concert_battles
   where space_id = new.space_id;

  if not found then
    raise exception 'concert battle invite requires a battle';
  end if;
  if new.sender_id <> v_initiator_id then
    raise exception 'concert battle invite sender must be the initiator';
  end if;
  if new.recipient_id = v_initiator_id
     or new.recipient_id is not distinct from v_opponent_id then
    raise exception 'concert battle invite recipient is not eligible';
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('accepted', 'declined', 'cancelled', 'expired')
     and new.status <> old.status then
    raise exception 'concert battle invite response is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists concert_battle_invite_guard_before_write
  on public.concert_battle_invites;
create trigger concert_battle_invite_guard_before_write
before insert or update on public.concert_battle_invites
for each row execute function public.concert_battle_invite_guard();

-- The existing generic host-promotion machinery mutates spaces.host_id. Once a
-- space has a battle aggregate, that must fail rather than silently moving
-- performer slot 1 to a moderator or speaker. PR 3 handles departure through
-- a battle-specific cancellation/forfeit path instead of host promotion.
create or replace function public.concert_battle_space_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiator_id uuid;
begin
  if tg_op = 'UPDATE' and old.room_format = 'versus_battle' then
    select initiator_id into v_initiator_id
      from public.concert_battles
     where space_id = old.id;

    if found and new.room_format is distinct from 'versus_battle' then
      raise exception 'concert battle space format is immutable';
    end if;
    if found and new.host_id <> v_initiator_id then
      raise exception 'concert battle initiator must remain the space host';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists concert_battle_space_guard_before_write on public.spaces;
create trigger concert_battle_space_guard_before_write
before update of host_id, room_format on public.spaces
for each row execute function public.concert_battle_space_guard();

-- Creates the room envelope, host presence, and battle aggregate together.
-- PR 2 wires this RPC to the dedicated Concert creation endpoint.
create or replace function public.create_concert_battle(
  p_initiator_id uuid,
  p_title text,
  p_topic text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_title = '' or char_length(v_title) > 200 then
    raise exception 'concert_battle_title_invalid';
  end if;
  if char_length(coalesce(p_topic, '')) > 500 then
    raise exception 'concert_battle_topic_invalid';
  end if;

  insert into public.spaces (
    title, topic, type, room_format, host_id, status, agora_channel
  ) values (
    v_title,
    coalesce(nullif(btrim(p_topic), ''), 'Concert Battle'),
    'creation',
    'versus_battle',
    p_initiator_id,
    'live',
    'melori_concert_' || replace(gen_random_uuid()::text, '-', '')
  )
  returning id into v_space_id;

  insert into public.space_participants (
    space_id, user_id, role, is_muted, left_at
  ) values (
    v_space_id, p_initiator_id, 'host', false, null
  )
  on conflict (space_id, user_id) do update
    set left_at = null;

  insert into public.concert_battles (space_id, initiator_id)
  values (v_space_id, p_initiator_id);

  return v_space_id;
end;
$$;

-- Serializes selection on the spaces row and replaces only a prior pending
-- invitation. It never assigns slot 2; acceptance is the only assignment path.
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
  v_invite_id uuid;
begin
  if p_initiator_id = p_recipient_id then
    raise exception 'concert_battle_self_invite';
  end if;
  if p_expires_at <= now() then
    raise exception 'concert_battle_invite_expired';
  end if;

  perform 1 from public.spaces where id = p_space_id for update;
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
  if v_battle.opponent_id is not null
     or v_battle.status not in ('selecting_opponent', 'invited') then
    raise exception 'concert_battle_opponent_locked';
  end if;
  if not exists (select 1 from public.profiles where id = p_recipient_id) then
    raise exception 'concert_battle_recipient_not_found';
  end if;
  if exists (
    select 1 from public.member_blocks b
     where (b.blocker_id = p_initiator_id and b.blocked_id = p_recipient_id)
        or (b.blocker_id = p_recipient_id and b.blocked_id = p_initiator_id)
  ) then
    raise exception 'concert_battle_recipient_blocked';
  end if;

  update public.concert_battle_invites
     set status = 'cancelled', responded_at = now()
   where space_id = p_space_id and status = 'pending';

  insert into public.concert_battle_invites (
    space_id, sender_id, recipient_id, status, expires_at
  ) values (
    p_space_id, p_initiator_id, p_recipient_id, 'pending', p_expires_at
  )
  returning id into v_invite_id;

  update public.concert_battles
     set status = 'invited', version = version + 1
   where space_id = p_space_id;

  return v_invite_id;
end;
$$;

-- Accepting an invite creates the fixed speaker presence and writes slot 2 once.
-- Declining returns the battle to opponent selection without changing slot 1.
create or replace function public.respond_concert_battle_invite(
  p_invite_id uuid,
  p_recipient_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_invite public.concert_battle_invites%rowtype;
  v_battle public.concert_battles%rowtype;
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

  perform 1 from public.spaces where id = v_space_id for update;
  select * into v_invite
    from public.concert_battle_invites
   where id = p_invite_id
   for update;
  select * into v_battle
    from public.concert_battles
   where space_id = v_space_id
   for update;

  if v_invite.recipient_id <> p_recipient_id then
    raise exception 'concert_battle_invite_recipient_required';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'concert_battle_invite_not_pending';
  end if;
  if v_invite.expires_at <= now() then
    update public.concert_battle_invites
       set status = 'expired'
     where id = v_invite.id;
    raise exception 'concert_battle_invite_expired';
  end if;
  if v_battle.opponent_id is not null then
    raise exception 'concert_battle_opponent_locked';
  end if;

  if p_action = 'decline' then
    update public.concert_battle_invites
       set status = 'declined', responded_at = now()
     where id = v_invite.id;
    update public.concert_battles
       set status = 'selecting_opponent', version = version + 1
     where space_id = v_space_id;
    return v_space_id;
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

  return v_space_id;
end;
$$;

revoke all on function public.create_concert_battle(uuid, text, text) from public;
revoke all on function public.invite_concert_opponent(uuid, uuid, uuid, timestamptz)
  from public;
revoke all on function public.respond_concert_battle_invite(uuid, uuid, text)
  from public;
grant execute on function public.create_concert_battle(uuid, text, text) to service_role;
grant execute on function public.invite_concert_opponent(uuid, uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.respond_concert_battle_invite(uuid, uuid, text)
  to service_role;

comment on table public.concert_battles is
  'Concert Battle aggregate. initiator_id is immutable performer slot 1; opponent_id is assigned once after an accepted invite and is immutable performer slot 2.';
comment on table public.concert_battle_rounds is
  'Future regulation-round ledger. Scores remain server-authoritative and are not readable directly by clients.';
comment on table public.concert_battle_invites is
  'Private durable Concert Battle invitations. Client access is denied; authenticated API routes use service-only RPCs.';
