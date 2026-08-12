-- 062_concert_battle_lockdown_anon_authenticated.sql
--
-- 060/061 revoked EXECUTE from PUBLIC, intending service_role-only access.
-- That revoke does not override this project's default privileges, which
-- grant EXECUTE on new public-schema functions to anon/authenticated
-- automatically. Close that explicitly for every Concert Battle RPC.

revoke execute on function public.create_concert_battle(uuid, text, text)
  from anon, authenticated;
revoke execute on function public.invite_concert_opponent(uuid, uuid, uuid, timestamptz)
  from anon, authenticated;
revoke execute on function public.cancel_concert_battle_invite(uuid, uuid)
  from anon, authenticated;
revoke execute on function public.expire_concert_battle_invites_for_recipient(uuid)
  from anon, authenticated;
revoke execute on function public.expire_concert_battle_invite_for_space(uuid)
  from anon, authenticated;
revoke execute on function public.respond_concert_battle_invite(uuid, uuid, text)
  from anon, authenticated;

-- Trigger/guard functions take no callable arguments matching a real RPC
-- shape, but lock them down too since they carry the same SECURITY DEFINER
-- exposure pattern.
revoke execute on function public.concert_battle_identity_guard()
  from anon, authenticated;
revoke execute on function public.concert_battle_round_identity_guard()
  from anon, authenticated;
revoke execute on function public.concert_battle_invite_guard()
  from anon, authenticated;
revoke execute on function public.concert_battle_space_guard()
  from anon, authenticated;
