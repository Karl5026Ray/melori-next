-- 029_host_auto_promotion.sql
-- Server-authoritative HOST auto-promotion for ALL live room types (MM Spaces
-- audio + MM Faces video). When the host disconnects/leaves we must never leave
-- a hostless zombie room: the OLDEST-tenured moderator inherits the room; if no
-- moderators are present the OLDEST-tenured speaker does; if neither exists the
-- room is ended gracefully.
--
-- Detection of the host leaving happens server-side (see the /leave route and
-- the PubNub presence webhook); both call the promote_next_host() RPC below.
-- The client is NEVER trusted to reassign host.
--
-- Tenure rule (documented): "oldest" = earliest space_participants.joined_at.
-- There is no separate "badge granted at" column, so join time is the stable,
-- fair ordering the schema supports (id as a deterministic tiebreaker).
--
-- Atomicity / race handling: multiple host-left signals can arrive at once
-- (browser `leave` beacon + PubNub `timeout` + presence interval). The function
-- takes a FOR UPDATE lock on the spaces row up front, so concurrent callers
-- serialize and only the FIRST one performs the host transfer; the rest observe
-- host_id already changed (or status already 'ended') and no-op. This guarantees
-- exactly one successor even with several moderators present.

create or replace function public.promote_next_host(
  p_space_id uuid,
  p_departing_host uuid default null
)
returns table (new_host_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space   record;
  v_candidate uuid;
  v_now     timestamptz := now();
begin
  -- Serialize concurrent host-left signals on this room. Whoever gets the lock
  -- first wins the transfer; later callers see the mutated state and no-op.
  select id, host_id, status
    into v_space
    from public.spaces
   where id = p_space_id
   for update;

  if not found then
    return query select null::uuid, 'not-found';
    return;
  end if;

  if v_space.status <> 'live' then
    return query select null::uuid, 'not-live';
    return;
  end if;

  -- If a specific departing host was named and they are NO LONGER the current
  -- host, another concurrent call already promoted a successor — no-op.
  if p_departing_host is not null and v_space.host_id <> p_departing_host then
    return query select v_space.host_id, 'already-promoted';
    return;
  end if;

  -- The host has left: make sure their participant row reflects that.
  update public.space_participants
     set left_at = coalesce(left_at, v_now)
   where space_id = p_space_id
     and user_id = v_space.host_id;

  -- 1) Oldest-tenured MODERATOR still present.
  select user_id
    into v_candidate
    from public.space_participants
   where space_id = p_space_id
     and left_at is null
     and user_id <> v_space.host_id
     and badge in ('mod', 'cohost')
   order by joined_at asc nulls last, id asc
   limit 1;

  -- 2) Else oldest-tenured SPEAKER still present.
  if v_candidate is null then
    select user_id
      into v_candidate
      from public.space_participants
     where space_id = p_space_id
       and left_at is null
       and user_id <> v_space.host_id
       and role in ('speaker', 'host')
     order by joined_at asc nulls last, id asc
     limit 1;
  end if;

  -- 3) Nobody eligible → end the room gracefully (no hostless zombie).
  if v_candidate is null then
    update public.spaces
       set status = 'ended',
           ended_at = coalesce(ended_at, v_now)
     where id = p_space_id
       and status = 'live';
    update public.space_participants
       set left_at = coalesce(left_at, v_now)
     where space_id = p_space_id
       and left_at is null;
    return query select null::uuid, 'ended-no-successor';
    return;
  end if;

  -- Transfer host. The FOR UPDATE lock above makes this the single winner.
  -- Promoting to host clears any raised hand / host-mute so they land fully
  -- on stage with moderation power (canPublish + host abilities are mirrored
  -- onto LiveKit by the server caller after this returns).
  update public.spaces
     set host_id = v_candidate
   where id = p_space_id;

  update public.space_participants
     set role = 'host',
         has_raised_hand = false,
         host_muted = false,
         is_muted = false
   where space_id = p_space_id
     and user_id = v_candidate;

  return query select v_candidate, 'promoted';
end;
$$;

comment on function public.promote_next_host(uuid, uuid) is
  'Atomically transfer host when the host leaves a live room: oldest moderator, else oldest speaker (by joined_at), else end the room. FOR UPDATE lock on the spaces row guarantees exactly one successor under concurrent host-left signals. Returns (new_host_id, outcome) where outcome is promoted | ended-no-successor | already-promoted | not-live | not-found.';
