-- 089_connect_18_plus.sql
--
-- Melori Connect is 18+ only (owner decision, 2026-10).
--
-- The API routes under /api/social/connect are the primary gate (see
-- src/lib/connectAgeGate.ts). This migration closes the two ways around them
-- that the 023 RLS policies leave open to any signed-in member holding the
-- anon key:
--
--   1. READ. "dating read active" let any authenticated user select every
--      active dating_profiles row straight from PostgREST — including rows
--      with no birthdate or an under-18 one. Other members' rows are now
--      visible only when they carry a birthdate at least 18 years old.
--      (`current_date - interval '18 years'` clamps Feb 29 to Feb 28 exactly
--      like birthdateCutoff() in src/lib/age.ts.)
--
--   2. WRITE. "dating update own" let a member PATCH their own birthdate
--      directly, sidestepping the API's lock. Once dating_profiles.birthdate
--      is set, end-user roles (anon / authenticated) can no longer change it.
--      The service role (our API, admin corrections) is unaffected.
--
-- Idempotent; safe to re-run. NOT applied automatically.

drop policy if exists "dating read active" on public.dating_profiles;
create policy "dating read active" on public.dating_profiles
  for select using (
    (select auth.uid()) = user_id
    or (
      is_active = true
      and birthdate is not null
      and birthdate <= (current_date - interval '18 years')::date
    )
  );

create or replace function public.dating_profiles_lock_birthdate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.birthdate is not null
     and new.birthdate is distinct from old.birthdate
     and coalesce((select auth.role()), '') in ('anon', 'authenticated') then
    raise exception 'Connect birthdate cannot be changed once set'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dating_profiles_lock_birthdate on public.dating_profiles;
create trigger trg_dating_profiles_lock_birthdate
  before update on public.dating_profiles
  for each row execute function public.dating_profiles_lock_birthdate();
