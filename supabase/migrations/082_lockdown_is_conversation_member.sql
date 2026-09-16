-- 082_lockdown_is_conversation_member
--
-- public.is_conversation_member(conv_id uuid, uid uuid) was SECURITY DEFINER
-- with EXECUTE granted to anon and authenticated, which exposes it at
-- /rest/v1/rpc/is_conversation_member. Two problems:
--
--   1. Anyone, signed in or not, could ask "is user X in conversation Y?" for
--      arbitrary ids. It is a membership oracle, not an API.
--   2. Revoking EXECUTE on its own does NOT fix it, because all six DM
--      policies call it and are declared TO public. A policy expression is
--      evaluated with the querying role's privileges, so a bare revoke turns
--      an anonymous read of public.messages from "0 rows" into
--      "permission denied for function is_conversation_member". Verified
--      against this database before writing this migration.
--
-- The fix has three parts, and all three are required:
--   * a 1-arg helper that answers only about the CALLER (auth.uid() is read
--     inside the function, never passed in), so there is nothing to probe;
--   * repoint the six policies at it and scope them TO authenticated, which
--     is a no-op for real traffic since every one of them already requires a
--     non-null auth.uid();
--   * revoke the 2-arg form from anon and authenticated, leaving it for
--     service_role only in case server-side code calls it with an explicit
--     uid.
--
-- auth.uid() is wrapped in a scalar subselect so the planner hoists it to an
-- InitPlan instead of re-evaluating per row, matching the convention set in
-- wrap_auth_calls_in_rls_initplan.

create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from public.conversation_members m
     where m.conversation_id = conv_id
       and m.user_id = (select auth.uid())
  );
$$;

comment on function public.is_conversation_member(uuid) is
  'RLS helper: is the CALLER a member of this conversation? Self-only by construction, so it cannot be used to probe other users.';

revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated, service_role;

-- Repoint the policies. ALTER POLICY rather than drop/create so there is no
-- window where the DM tables are unprotected.
alter policy conversation_members_select_same_conv on public.conversation_members
  to authenticated
  using (public.is_conversation_member(conversation_id));

alter policy conversations_select_member on public.conversations
  to authenticated
  using (public.is_conversation_member(id));

alter policy conversations_update_member on public.conversations
  to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

alter policy messages_select_member on public.messages
  to authenticated
  using (public.is_conversation_member(conversation_id));

alter policy messages_insert_self_member on public.messages
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
  );

alter policy messages_update_own on public.messages
  to authenticated
  using (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
  )
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
  );

-- Now that nothing in the API path depends on it, close the 2-arg oracle.
revoke all on function public.is_conversation_member(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to service_role;

comment on function public.is_conversation_member(uuid, uuid) is
  'Server-side only. Takes an explicit user id, so it must never be exposed to anon or authenticated. Policies use the 1-arg self-only form.';
