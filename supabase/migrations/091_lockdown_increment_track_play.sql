-- 091_lockdown_increment_track_play
--
-- Applied to production 2026-10-06.
--
-- Anyone, even signed out, could call /rest/v1/rpc/increment_track_play in a
-- loop and inflate a track's play_count (Supabase security advisor:
-- anon_security_definer_function_executable). No app code calls it today, so
-- only the server (service_role) may count plays from now on. A future
-- play-count route should call it server-side after its own dedupe/rate limit.
revoke execute on function public.increment_track_play(integer) from public, anon, authenticated;
grant execute on function public.increment_track_play(integer) to service_role;
