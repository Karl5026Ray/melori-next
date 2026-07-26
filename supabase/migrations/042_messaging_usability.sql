-- Migration 042: messaging_usability
--
-- Self-contained and additive. Written against the LIVE production schema, not
-- against the migration files: `conversations`, `conversation_members` and
-- `messages` were originally created by hand in the Supabase console and the
-- policies migration 009 describes were never applied to production. What is
-- actually live there is a set of hand-written policies, three of which are
-- defective, and `public.is_conversation_member(uuid, uuid)` does not exist at
-- all — which is why the first version of this migration failed with
-- `42883: function public.is_conversation_member(uuid, uuid) does not exist`.
--
-- This migration therefore:
--
--   1. Creates `public.is_conversation_member()` itself instead of assuming it.
--   2. Adds the columns the DM code already reads and writes:
--        * conversations.status / conversations.requested_by — used by
--          /api/social/conversations/start, /[id] and /[id]/request. Without
--          them the message-request flow errors out.
--        * messages.deleted_at — written by DELETE /api/social/messages/[id]
--          and read by MessageBubble as the "Message deleted" tombstone.
--   3. Repairs the three defective live policies (see section 4).
--   4. Adds the sender+time index the unread counters need.
--   5. Adds public.messages to the supabase_realtime publication, so the chat
--      page's postgres_changes subscription actually receives inserts.
--
-- Every statement is idempotent: safe to run twice. Nothing is dropped except
-- policies, which are immediately recreated. No column is dropped, no row is
-- deleted.

begin;

-- ---------------------------------------------------------------------------
-- 1) Membership helper
--
-- SECURITY DEFINER is required, not cosmetic: this is called from policies ON
-- conversation_members, so a non-definer function would re-trigger RLS on that
-- table and recurse. STABLE lets the planner call it once per query rather than
-- once per row. The explicit search_path stops a caller-supplied search_path
-- from resolving `conversation_members` to another schema.
--
-- Parameter names match migration 009 (`conv_id`, `uid`) so that on any database
-- where 009 *was* applied this is a plain CREATE OR REPLACE rather than a
-- signature change, which Postgres would reject.
-- ---------------------------------------------------------------------------
create or replace function public.is_conversation_member(conv_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.conversation_members m
     where m.conversation_id = conv_id
       and m.user_id = uid
  );
$$;

revoke all on function public.is_conversation_member(uuid, uuid) from public;
grant execute on function public.is_conversation_member(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Columns
--
-- The messaging tables in production predate version control, so the columns
-- the app relies on are asserted here rather than assumed. Each statement is a
-- no-op where the column already exists.
-- ---------------------------------------------------------------------------

-- Request / accept lifecycle for 1:1 threads.
alter table public.conversations
  add column if not exists status text not null default 'accepted';

alter table public.conversations
  add column if not exists requested_by uuid
  references public.profiles(id) on delete set null;

-- Added NOT VALID and validated separately so the migration cannot fail on a
-- database that already holds a status outside the vocabulary.
alter table public.conversations
  drop constraint if exists conversations_status_chk;
alter table public.conversations
  add constraint conversations_status_chk
  check (status in ('pending', 'accepted', 'declined'))
  not valid;

do $$
begin
  alter table public.conversations validate constraint conversations_status_chk;
exception when others then
  null; -- legacy rows outside the vocabulary; leave the constraint not-validated
end $$;

-- The inbox orders by updated_at; production maintains it with the
-- update_conversation_timestamp() trigger.
alter table public.conversations
  add column if not exists updated_at timestamptz not null default now();

-- Read cursor per member — drives unread counts and read receipts.
alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

-- Soft delete: a deleted message becomes a tombstone instead of vanishing, so
-- thread ordering stays coherent for the other participant.
alter table public.messages
  add column if not exists deleted_at timestamptz;

alter table public.messages
  add column if not exists is_edited boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3) Index
--
-- Unread counting reads "messages in this conversation newer than my
-- last_read_at that I did not send". The existing conversation+time index
-- cannot serve the sender predicate, so this adds it.
-- ---------------------------------------------------------------------------
create index if not exists messages_conv_sender_created_idx
  on public.messages (conversation_id, sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) Row Level Security
--
-- Three live policies are defective and are replaced here. Legacy hand-written
-- policy names are dropped alongside the canonical ones so the end state is the
-- same whether or not migration 009 ever ran on the target database.
--
-- DEFECT 1 — `conversations` SELECT was a broken self-join. The live predicate
--   read `conversation_members.conversation_id = conversation_members.id`: the
--   subquery's own table shadowed the outer `conversations`, so it compared a
--   foreign key to that same table's primary key instead of to
--   `conversations.id`. It can essentially never be true, so no member could
--   SELECT a conversation under RLS at all. Replaced with a call to
--   is_conversation_member(), which cannot be miswritten the same way.
--
-- DEFECT 2 — `messages` INSERT did not check membership. It only checked
--   `auth.uid() = sender_id`, so any authenticated user could insert a message
--   into ANY conversation_id, including threads they are not part of, simply by
--   setting themselves as sender. A real write hole into other members'
--   threads. Membership is now required as well.
--
-- DEFECT 3 — `conversation_members` INSERT was effectively open. The live
--   predicate was `(auth.uid() = user_id) OR (auth.uid() IS NOT NULL)`; the
--   second branch subsumes the first, so any authenticated user could add ANY
--   user to ANY conversation. Combined with defect 2 that let a stranger insert
--   themselves into someone else's thread and then post in it. The OR branch is
--   removed. Every legitimate insert (opening a 1:1) happens server-side under
--   the service role, which bypasses RLS, so nothing in the app depends on the
--   removed branch.
--
-- SECONDARY — `messages` UPDATE had a USING clause but no WITH CHECK, so a
--   sender could update their own row in a way that reassigned sender_id to
--   somebody else. The new policy repeats the predicate in WITH CHECK, which
--   pins sender_id to the caller on the post-update row.
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- conversations: SELECT (defect 1) ------------------------------------------
drop policy if exists "Members view conversations" on public.conversations;
drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member" on public.conversations
  for select using (public.is_conversation_member(id, auth.uid()));

-- conversations: INSERT ------------------------------------------------------
-- Behaviour is unchanged from the live policy (any signed-in user may open a
-- conversation row); only the name is normalised. Members are attached
-- server-side, and a conversation nobody is a member of is inert — with defect
-- 3 fixed it can no longer be populated with someone else.
drop policy if exists "Authenticated create conversations" on public.conversations;
drop policy if exists "conversations_insert_authenticated" on public.conversations;
create policy "conversations_insert_authenticated" on public.conversations
  for insert with check (auth.uid() is not null);

-- conversations: UPDATE ------------------------------------------------------
-- Lets a participant accept/decline a request on their own thread.
drop policy if exists "conversations_update_member" on public.conversations;
create policy "conversations_update_member" on public.conversations
  for update using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

-- conversation_members: SELECT ----------------------------------------------
drop policy if exists "Members view membership" on public.conversation_members;
drop policy if exists "conversation_members_select_same_conv" on public.conversation_members;
create policy "conversation_members_select_same_conv" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

-- conversation_members: INSERT (defect 3) -----------------------------------
drop policy if exists "Users add self to conversations" on public.conversation_members;
drop policy if exists "conversation_members_insert_self" on public.conversation_members;
create policy "conversation_members_insert_self" on public.conversation_members
  for insert with check (user_id = auth.uid());

-- conversation_members: UPDATE ----------------------------------------------
-- Only the caller's own membership row, and it must stay theirs. This is the
-- last_read_at write path.
drop policy if exists "conversation_members_update_self" on public.conversation_members;
create policy "conversation_members_update_self" on public.conversation_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- messages: SELECT -----------------------------------------------------------
drop policy if exists "Messages readable by members" on public.messages;
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

-- messages: INSERT (defect 2) ------------------------------------------------
drop policy if exists "Users send messages" on public.messages;
drop policy if exists "messages_insert_self_member" on public.messages;
create policy "messages_insert_self_member" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

-- messages: UPDATE (secondary) -----------------------------------------------
-- Edit / soft-delete of the caller's OWN message. WITH CHECK is what stops
-- sender_id being reassigned by the update.
drop policy if exists "Users edit own messages" on public.messages;
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

-- ---------------------------------------------------------------------------
-- 5) Realtime
--
-- Guarded so it is a no-op when the publication already includes the table, is
-- FOR ALL TABLES, or does not exist in this environment. RLS still applies to
-- realtime payloads, so a subscriber only receives inserts for conversations
-- they are a member of.
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null; -- publication not present in this env
end $$;

commit;
