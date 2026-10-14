-- 096_participants_self_promotion_guard
--
-- Closes a live privilege escalation (verified on prod 2026-10-14 with a
-- rolled-back probe): the "Users update own participation" policy lets a
-- signed-in member update ANY column of their own space_participants row, and
-- "Users can join spaces" lets them insert a row with any role. /api/livekit-token
-- trusts role ('speaker'/'host') and badge ('mod'/'cohost') when deciding who may
-- publish, so a listener could put themselves on stage, or make themselves a
-- moderator, without the host. Migration 017's guard trigger was never applied.
--
-- Every legitimate role/badge/host-mute change already goes through server
-- routes that use the service role (participants/[userId], raise-hand,
-- livekit-token, the LiveKit webhook). Browser writes only ever:
--   * insert their own row as 'audience' (or 'host' when they ARE the host),
--   * clear/set left_at, is_muted, has_raised_hand, stage_requested_at,
--   * step themselves down to 'audience' (Faces rejoin, Cinema seat step-down).
-- This trigger enforces exactly that for client roles and leaves the service
-- role, postgres and SECURITY DEFINER functions untouched.
--
-- Applied to prod 2026-10-14 via apply_migration; verified with rolled-back
-- probes: self-promote to speaker/mod, insert-as-speaker blocked; mute, raise
-- hand, leave, step-down, host rejoin and service-role promotion still work.

create or replace function public.guard_space_participant_self_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_is_host boolean;
begin
  -- Only browser-originated writes are restricted.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select exists (
    select 1 from public.spaces s
    where s.id = new.space_id and s.host_id = new.user_id
  ) into v_is_host;

  if tg_op = 'INSERT' then
    if coalesce(new.role, 'audience') <> 'audience'
       and not (new.role = 'host' and v_is_host) then
      raise exception 'participants may only join as audience'
        using errcode = '42501';
    end if;
    if new.badge is not null or coalesce(new.host_muted, false) then
      raise exception 'badge and host mute are set by the host'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.space_id is distinct from old.space_id
     or new.user_id is distinct from old.user_id then
    raise exception 'participant rows cannot be moved'
      using errcode = '42501';
  end if;
  if new.badge is distinct from old.badge
     or new.host_muted is distinct from old.host_muted then
    raise exception 'badge and host mute are set by the host'
      using errcode = '42501';
  end if;
  if new.role is distinct from old.role
     and new.role <> 'audience'
     and not (new.role = 'host' and v_is_host) then
    raise exception 'stage roles are granted by the host'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_guard_space_participant_self_write
  before insert or update on public.space_participants
  for each row execute function public.guard_space_participant_self_write();
