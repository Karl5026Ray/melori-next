-- 038_admin_hard_delete_profile.sql
-- Transactional hard-delete of a member's Postgres footprint, used by the
-- admin-only "Permanently delete" control (see
-- src/app/api/admin/accounts/[id]/hard-delete/route.ts). The founder needs to
-- purge duplicate accounts completely — not soft-delete them.
--
-- WHY AN RPC: most social tables reference profiles(id) / auth.users(id) with
-- ON DELETE CASCADE, so deleting the profile row (and later the auth user)
-- removes them automatically. A handful of legacy columns, however, reference
-- profiles(id) with the DEFAULT (NO ACTION) rule and would otherwise BLOCK the
-- cascade with a foreign-key violation. This function nulls those references
-- and deletes the profile row inside a single transaction (a function body is
-- atomic), so the cleanup can't half-apply.
--
-- The auth.users row itself is deleted AFTER this RPC by the API route via the
-- service role (auth.admin.deleteUser) — that step cascades the auth-schema
-- rows and the tables that hang off auth.users(id) (follows, member_blocks,
-- humanizer_access, etc.) and makes the login unrecoverable.
--
-- Guarded with to_regclass so a deployment missing any of these optional tables
-- doesn't error.

create or replace function public.admin_hard_delete_profile(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Clear NO-ACTION references that would block deletion of the profile row.
  if to_regclass('public.audit_logs') is not null then
    update public.audit_logs set actor_id = null where actor_id = target_id;
  end if;
  if to_regclass('public.orders') is not null then
    update public.orders set user_id = null where user_id = target_id;
  end if;
  if to_regclass('public.tracks') is not null then
    update public.tracks set moderated_by = null where moderated_by = target_id;
  end if;
  if to_regclass('public.track_submissions') is not null then
    -- profile_id is NO ACTION; drop the submission rows outright.
    delete from public.track_submissions where profile_id = target_id;
  end if;
  if to_regclass('public.humanizer_access') is not null then
    -- granted_by references auth.users(id) NO ACTION; null it so this user can
    -- still be removed even if they granted access to others.
    update public.humanizer_access set granted_by = null where granted_by = target_id;
  end if;

  -- Delete the profile row. This cascades every table that references
  -- profiles(id) ON DELETE CASCADE and nulls the ON DELETE SET NULL ones.
  delete from public.profiles where id = target_id;
end;
$$;

-- Only the service role (server-side admin routes) should ever call this. It is
-- never exposed to the anon/authenticated client.
revoke all on function public.admin_hard_delete_profile(uuid) from public;
revoke all on function public.admin_hard_delete_profile(uuid) from anon;
revoke all on function public.admin_hard_delete_profile(uuid) from authenticated;
grant execute on function public.admin_hard_delete_profile(uuid) to service_role;
