-- Durable, capacity-constrained camera reservations for Cinema. The fixed
-- primary key makes the three visual camera tiles a database invariant rather
-- than a best-effort client convention.

create table if not exists public.cinema_camera_slots (
  space_id uuid not null references public.spaces(id) on delete cascade,
  slot smallint not null check (slot between 0 and 2),
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (space_id, slot),
  unique (space_id, user_id)
);

create index if not exists cinema_camera_slots_user_idx
  on public.cinema_camera_slots (space_id, user_id);

alter table public.cinema_camera_slots enable row level security;

-- Slots are exposed through the room API, which can apply room visibility
-- rules. Direct table access stays service-role-only.

create or replace function public.ensure_cinema_host_camera_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.room_format = 'cinema' then
    delete from public.cinema_camera_slots
    where space_id = new.id and (slot = 0 or user_id = new.host_id);
    insert into public.cinema_camera_slots (space_id, slot, user_id, assigned_by)
    values (new.id, 0, new.host_id, new.host_id)
    on conflict (space_id, slot) do update
      set user_id = excluded.user_id, assigned_by = excluded.assigned_by, updated_at = now();
  elsif tg_op = 'UPDATE' and old.room_format = 'cinema' then
    delete from public.cinema_camera_slots where space_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_cinema_host_camera_slot_on_insert on public.spaces;
drop trigger if exists ensure_cinema_host_camera_slot_on_write on public.spaces;
create trigger ensure_cinema_host_camera_slot_on_write
  after insert or update of host_id, room_format on public.spaces
  for each row execute function public.ensure_cinema_host_camera_slot();

-- Establish slot zero for Cinema rows created before this migration.
insert into public.cinema_camera_slots (space_id, slot, user_id, assigned_by)
select id, 0, host_id, host_id
from public.spaces
where room_format = 'cinema'
on conflict (space_id, slot) do nothing;

create or replace function public.cinema_camera_slot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_format text;
begin
  select host_id, room_format into v_host_id, v_format
  from public.spaces
  where id = new.space_id;

  if v_format is distinct from 'cinema' then
    raise exception 'camera slots are only valid for Cinema rooms';
  end if;
  if (new.slot = 0 and new.user_id <> v_host_id)
     or (new.slot <> 0 and new.user_id = v_host_id) then
    raise exception 'Cinema slot zero is reserved for the current host';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cinema_camera_slot_guard_before_write on public.cinema_camera_slots;
create trigger cinema_camera_slot_guard_before_write
  before insert or update on public.cinema_camera_slots
  for each row execute function public.cinema_camera_slot_guard();

-- Atomic guest-slot claim. The spaces row lock serializes the "find vacancy
-- then insert" decision using the same lock order as host promotion. Existing
-- owners keep their seat, and a full room returns no row.
create or replace function public.claim_cinema_camera_slot(
  p_space_id uuid,
  p_user_id uuid,
  p_assigned_by uuid
)
returns table(slot smallint, user_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_format text;
  v_slot smallint;
  v_eligible boolean;
begin
  -- The spaces row is the single room-scoped serialization lock. Host
  -- promotion already takes this lock before firing the slot-zero trigger, so
  -- claim/release must use the same order and must not take a second lock first.
  select host_id, room_format into v_host_id, v_format
  from public.spaces
  where id = p_space_id
  for update;

  if not found then
    raise exception 'Cinema room not found';
  end if;
  if v_format is distinct from 'cinema' then
    raise exception 'camera slots are only valid for Cinema rooms';
  end if;

  insert into public.cinema_camera_slots (space_id, slot, user_id, assigned_by)
  values (p_space_id, 0, v_host_id, v_host_id)
  on conflict (space_id, slot) do nothing;

  if p_user_id = v_host_id then
    return query select 0::smallint, p_user_id, false;
    return;
  end if;

  select (
    sp.left_at is null
    and coalesce(sp.host_muted, false) = false
    and (
      sp.role in ('speaker', 'host')
      or sp.badge in ('mod', 'cohost')
    )
  )
  into v_eligible
  from public.space_participants sp
  where sp.space_id = p_space_id and sp.user_id = p_user_id
  for update;

  if coalesce(v_eligible, false) = false then
    raise exception 'participant is not eligible for a Cinema camera';
  end if;

  select c.slot into v_slot
  from public.cinema_camera_slots c
  where c.space_id = p_space_id and c.user_id = p_user_id;
  if found then
    return query select v_slot, p_user_id, false;
    return;
  end if;

  select s.slot into v_slot
  from (values (1::smallint), (2::smallint)) as s(slot)
  where not exists (
    select 1 from public.cinema_camera_slots c
    where c.space_id = p_space_id and c.slot = s.slot
  )
  order by s.slot
  limit 1;

  if v_slot is null then
    return;
  end if;

  insert into public.cinema_camera_slots (space_id, slot, user_id, assigned_by)
  values (p_space_id, v_slot, p_user_id, p_assigned_by);

  return query select v_slot, p_user_id, true;
end;
$$;

-- Release only guest seats. Slot zero follows host ownership and remains
-- reserved so a transient host reconnect never allows a guest to occupy it.
create or replace function public.release_cinema_camera_slot(
  p_space_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
begin
  select host_id into v_host_id from public.spaces where id = p_space_id for update;
  if not found then
    return false;
  end if;
  if p_user_id = v_host_id then
    return false;
  end if;
  delete from public.cinema_camera_slots
  where space_id = p_space_id and user_id = p_user_id and slot in (1, 2);
  return found;
end;
$$;

revoke all on function public.claim_cinema_camera_slot(uuid, uuid, uuid) from public;
revoke all on function public.release_cinema_camera_slot(uuid, uuid) from public;
grant execute on function public.claim_cinema_camera_slot(uuid, uuid, uuid) to service_role;
grant execute on function public.release_cinema_camera_slot(uuid, uuid) to service_role;

comment on table public.cinema_camera_slots is
  'Exactly three durable Cinema camera reservations: slot 0 is current host, slots 1-2 are guests. Claims/releases serialize on the spaces row.';
