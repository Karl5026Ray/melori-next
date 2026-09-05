-- 073_lockdown_room_rpc_execute_grants.sql
--
-- Migration 057 revoked the Cinema slot RPCs "from public" and granted them to
-- service_role. That is not sufficient on Supabase: new functions in the public
-- schema receive EXECUTE grants *directly* on the `anon` and `authenticated`
-- roles, and `revoke ... from public` does not remove an explicit role grant.
--
-- Verified against production on 2026-09-05 with has_function_privilege():
-- anon held EXECUTE on every function listed below, including
-- claim_cinema_camera_slot and release_cinema_camera_slot, despite 057.
--
-- Impact: each was reachable unauthenticated at /rest/v1/rpc/<fn>. None of them
-- check auth.uid() -- they validate room state, not the caller -- because they
-- were written on the assumption that only trusted server code could call them.
-- The most serious is promote_next_host(), whose "no eligible successor" branch
-- sets spaces.status = 'ended' and marks every participant left: a stranger
-- with a room id could end any live room.
--
-- Behaviour-preserving: every application caller uses getSupabaseAdmin()
-- (service_role).
--   promote_next_host              src/lib/roomHost.ts
--   claim/release camera slot      src/app/api/social/spaces/[spaceId]/...
--   increment_space_hearts         src/app/api/social/spaces/[spaceId]/hearts/route.ts
--   increment_gallery_view_count   src/app/gallery/[slug]/page.tsx
--   increment_gallery_download_count  src/app/api/gallery/download/route.ts
--
-- Deliberately NOT changed here:
--   increment_track_play(integer)     called from the browser by
--                                     src/components/player/PlayerProvider.tsx
--   is_conversation_member(uuid,uuid) evaluated inside the messaging RLS
--                                     policies as the signed-in caller (042)

-- ---------------------------------------------------------------- room RPCs
revoke all on function public.promote_next_host(uuid, uuid)
  from anon, authenticated, public;
grant execute on function public.promote_next_host(uuid, uuid) to service_role;

revoke all on function public.claim_cinema_camera_slot(uuid, uuid, uuid)
  from anon, authenticated, public;
grant execute on function public.claim_cinema_camera_slot(uuid, uuid, uuid) to service_role;

revoke all on function public.release_cinema_camera_slot(uuid, uuid)
  from anon, authenticated, public;
grant execute on function public.release_cinema_camera_slot(uuid, uuid) to service_role;

revoke all on function public.increment_space_hearts(uuid, integer)
  from anon, authenticated, public;
grant execute on function public.increment_space_hearts(uuid, integer) to service_role;

revoke all on function public.expire_stale_live_invites()
  from anon, authenticated, public;
grant execute on function public.expire_stale_live_invites() to service_role;

-- ------------------------------------------------------------- gallery RPCs
revoke all on function public.increment_gallery_view_count(uuid)
  from anon, authenticated, public;
grant execute on function public.increment_gallery_view_count(uuid) to service_role;

revoke all on function public.increment_gallery_download_count(uuid)
  from anon, authenticated, public;
grant execute on function public.increment_gallery_download_count(uuid) to service_role;

-- -------------------------------------------------------- trigger functions
-- Trigger functions execute as the table owner when the trigger fires, so no
-- role needs EXECUTE. Exposing them over PostgREST only let callers run the
-- body out of trigger context.
revoke all on function public.cinema_camera_slot_guard()
  from anon, authenticated, public;
revoke all on function public.ensure_cinema_host_camera_slot()
  from anon, authenticated, public;
revoke all on function public.sync_gallery_likes_count()
  from anon, authenticated, public;
revoke all on function public.sync_gallery_comments_count()
  from anon, authenticated, public;
revoke all on function public.concert_battle_identity_guard()
  from anon, authenticated, public;
revoke all on function public.concert_battle_invite_guard()
  from anon, authenticated, public;
revoke all on function public.concert_battle_round_identity_guard()
  from anon, authenticated, public;
revoke all on function public.concert_battle_space_guard()
  from anon, authenticated, public;
