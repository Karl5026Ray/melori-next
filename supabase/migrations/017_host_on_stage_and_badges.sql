-- 017_host_on_stage_and_badges.sql
-- Fix: creators/hosts start ON STAGE (role='host') instead of in the audience.
-- Adds: participant badges (cohost/mod/vip) so trusted users can help run the room.

-- 1) Participant badges. NULL = no badge.
alter table public.space_participants
  add column if not exists badge text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'space_participants_badge_check') then
    alter table public.space_participants
      add constraint space_participants_badge_check
      check (badge is null or badge in ('cohost','mod','vip'));
  end if;
end $$;

-- 2) THE FIX: whenever a space_participants row is written for the user who is
--    the space's host, force role='host' and unmute them so they land ON STAGE.
--    This corrects the client bug where every joiner was inserted as 'audience'.
create or replace function public.enforce_host_on_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
begin
  select host_id into v_host_id from public.spaces where id = new.space_id;
  if v_host_id is not null and new.user_id = v_host_id then
    new.role := 'host';
    new.is_muted := false;
    new.host_muted := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_host_on_stage on public.space_participants;
create trigger trg_enforce_host_on_stage
before insert or update on public.space_participants
for each row execute function public.enforce_host_on_stage();
