-- Migration 042: messaging_usability
--
-- Additive-only. Closes the gap between what the DM code already expects and
-- what migration 009 actually created:
--
--   * conversations.status / conversations.requested_by — read and written by
--     /api/social/conversations/start, /[id] and /[id]/request, but never
--     added to the schema. Without them the message-request flow errors out.
--   * messages.deleted_at — written by DELETE /api/social/messages/[id] and
--     read by MessageBubble as the "Message deleted" tombstone.
--   * public.messages was never added to the supabase_realtime publication, so
--     the chat page's postgres_changes subscription received nothing and new
--     messages only appeared after a manual refresh.
--
-- Every statement is idempotent. No destructive changes.

-- 1) conversations: request/accept lifecycle ---------------------------------
alter table public.conversations
  add column if not exists status text not null default 'accepted';

alter table public.conversations
  add column if not exists requested_by uuid references public.profiles(id) on delete set null;

alter table public.conversations
  drop constraint if exists conversations_status_chk;
alter table public.conversations
  add constraint conversations_status_chk
  check (status in ('pending', 'accepted', 'declined'));

-- 2) messages: soft delete ---------------------------------------------------
alter table public.messages
  add column if not exists deleted_at timestamptz;

-- Unread counting reads "messages in this conversation newer than my
-- last_read_at, not sent by me". messages_conv_created_idx already covers the
-- conversation+time part; this adds the sender so the count can be satisfied
-- from the index alone.
create index if not exists messages_conv_sender_created_idx
  on public.messages (conversation_id, sender_id, created_at desc);

-- 3) Row Level Security ------------------------------------------------------
-- Migration 009 already enabled RLS and added the participant-scoped SELECT /
-- INSERT policies for conversations, conversation_members and messages. The
-- two write paths added since then are covered here so a member can maintain
-- their own rows without the API having to fall back to the service role:
--
--   * a sender soft-deleting or editing their OWN message
--   * accepting / declining a request on a conversation they participate in
--
-- Both are still scoped by is_conversation_member(), so a user can never read
-- or write a thread they are not a participant of.

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  )
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists "conversations_update_member" on public.conversations;
create policy "conversations_update_member" on public.conversations
  for update using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

-- 4) Realtime ----------------------------------------------------------------
-- Guarded so it is a no-op when the publication already includes the table or
-- is FOR ALL TABLES. RLS still applies to realtime payloads, so a subscriber
-- only receives inserts for conversations they are a member of.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null; -- publication not present in this env
end $$;
