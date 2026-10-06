-- 093_message_reactions_user_fk_auth
--
-- Hotfix (2026-10-06). Migration 092 gave message_reactions.user_id a foreign
-- key to public.profiles. messages.sender_id already references profiles, so
-- PostgREST then saw TWO ways from messages to profiles (the direct sender
-- link, and a many-to-many through message_reactions) and refused every
-- `sender:profiles(...)` embed with PGRST201. Threads loaded empty.
--
-- Point user_id at auth.users instead. profiles.id itself references
-- auth.users, so integrity is unchanged and the ambiguity is gone. The app
-- also names the join explicitly now (profiles!messages_sender_id_fkey).
alter table public.message_reactions
  drop constraint if exists message_reactions_user_id_fkey;
alter table public.message_reactions
  add constraint message_reactions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
notify pgrst, 'reload schema';
