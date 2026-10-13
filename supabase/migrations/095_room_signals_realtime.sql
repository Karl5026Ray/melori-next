-- 095_room_signals_realtime
-- PubNub is removed (Karl, 13 Oct 2026: "we already use Supabase"). In-room
-- live signals move to Supabase Realtime private channels:
--
--   room:<space_id>      members send peer signals (reactions, raise-hand) and
--                        track presence.
--   room-sys:<space_id>  members may only LISTEN. The server writes here with
--                        the service role (which bypasses RLS): space-ended,
--                        host-changed, concert vote tallies. No insert policy
--                        covers this topic, so a participant cannot forge them.
--
-- Membership reuses public.is_in_space() from 094: open rooms are open to any
-- signed-in user, private (audition) rooms only to the host and admitted users.

create or replace function public.can_use_room_channel(p_topic text, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^room:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.is_in_space(split_part(p_topic, ':', 2)::uuid)
    when not p_write
     and p_topic ~ '^room-sys:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.is_in_space(split_part(p_topic, ':', 2)::uuid)
    else false
  end;
$$;

revoke all on function public.can_use_room_channel(text, boolean) from public, anon;
grant execute on function public.can_use_room_channel(text, boolean) to authenticated;

drop policy if exists room_channels_receive on realtime.messages;
create policy room_channels_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_use_room_channel((select realtime.topic()), false)
  );

drop policy if exists room_channels_send on realtime.messages;
create policy room_channels_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_use_room_channel((select realtime.topic()), true)
  );
