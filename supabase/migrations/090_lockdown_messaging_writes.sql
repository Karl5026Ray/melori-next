-- 090_lockdown_messaging_writes
--
-- Applied to production 2026-10-06 (ledger version 20261006150000). Originally
-- numbered 086; renumbered to 090 because open PRs #411-#413 already claim
-- 086-089 (concert_votes, drop_payments, mirror bucket, connect 18+).
--
-- Phase 0 of the Messages upgrade: close the holes in DMs before groups land.
--
-- Verified on production 2026-10-06 (probe ran in a transaction that was
-- rolled back): a signed-in member who was NOT in a conversation could insert
-- themselves into conversation_members through the public API and then read
-- that conversation's full history. Every legitimate write to these three
-- tables already goes through service-role API routes
-- (src/app/api/social/**, src/lib/direct-conversation.ts), so the client-side
-- write policies only ever served attackers:
--
--   conversation_members_insert_self  -> join any conversation by id
--   conversation_members_update_self  -> re-point your own row at any
--                                        conversation (same hole via UPDATE)
--   conversations_insert_authenticated-> create orphan conversations
--   conversations_update_member       -> flip a pending request to accepted
--   messages_insert_self_member       -> post around moderation, blocks and
--                                        rate limits
--   messages_update_own               -> rewrite text after moderation, undo
--                                        a delete
--
-- SELECT policies stay: the thread page reads messages with the user's
-- session and postgres_changes realtime depends on them.

-- 1. Drop client write policies --------------------------------------------
drop policy if exists conversation_members_insert_self  on public.conversation_members;
drop policy if exists conversation_members_update_self  on public.conversation_members;
drop policy if exists conversations_insert_authenticated on public.conversations;
drop policy if exists conversations_update_member       on public.conversations;
drop policy if exists messages_insert_self_member       on public.messages;
drop policy if exists messages_update_own               on public.messages;

-- Defence in depth: no write privilege at all for API roles. anon never needs
-- to read DMs either. service_role is unaffected.
revoke insert, update, delete, truncate, references, trigger
  on public.conversations, public.conversation_members, public.messages
  from anon, authenticated;
revoke select on public.conversations, public.conversation_members, public.messages
  from anon;

-- 2. Duplicate CHECK left behind by 042 (identical to conversations_status_check)
alter table public.conversations drop constraint if exists conversations_status_chk;

-- 3. Deleting a message must actually remove its text -----------------------
-- Before this, DELETE /api/social/messages/[id] only stamped deleted_at and
-- the other member could still SELECT the content. Enforced in the database
-- so no future code path can forget it.
create or replace function public.messages_scrub_on_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    new.content := '';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_scrub_on_delete on public.messages;
create trigger messages_scrub_on_delete
  before update of deleted_at, content on public.messages
  for each row execute function public.messages_scrub_on_delete();

update public.messages set content = '' where deleted_at is not null and content <> '';

-- 4. Private realtime channels for typing + call signalling -----------------
-- typing:<conversationId> and call:<conversationId> were public broadcast
-- channels: anyone with the anon key and a conversation id could listen to or
-- spoof typing and WebRTC call signalling. The client now joins them with
-- { private: true }; these policies admit members of that conversation only.
-- Public and private channels with the same topic are separate channels, so
-- the old public topic reaches nobody once clients switch. Other features'
-- public channels (Spaces, Cinema, Faces) are untouched: RLS on
-- realtime.messages only applies to private channels.
create or replace function public.can_use_dm_channel(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^(typing|call):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then exists (
      select 1
        from public.conversation_members m
       where m.conversation_id = split_part(p_topic, ':', 2)::uuid
         and m.user_id = (select auth.uid())
    )
    else false
  end;
$$;

revoke all on function public.can_use_dm_channel(text) from public, anon;
grant execute on function public.can_use_dm_channel(text) to authenticated;

drop policy if exists dm_channels_receive on realtime.messages;
create policy dm_channels_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_use_dm_channel((select realtime.topic()))
  );

drop policy if exists dm_channels_send on realtime.messages;
create policy dm_channels_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_use_dm_channel((select realtime.topic()))
  );

-- 5. Inbox summary in one query ---------------------------------------------
-- GET /api/social/conversations used to embed EVERY message of up to 50
-- conversations just to show the newest one and an unread count. This returns
-- exactly that, using idx_messages_conversation (conversation_id, created_at).
-- Service role only: the route verifies the caller and passes their id.
create or replace function public.dm_inbox_summary(p_user uuid, p_conv_ids uuid[])
returns table (
  conversation_id uuid,
  last_message_id uuid,
  last_content text,
  last_created_at timestamptz,
  last_sender_id uuid,
  unread_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.conversation_id,
         l.id,
         l.content,
         l.created_at,
         l.sender_id,
         (select count(*)::int
            from public.messages u
           where u.conversation_id = m.conversation_id
             and u.deleted_at is null
             and u.sender_id <> p_user
             and u.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz))
    from public.conversation_members m
    left join lateral (
      select x.id, x.content, x.created_at, x.sender_id
        from public.messages x
       where x.conversation_id = m.conversation_id
         and x.deleted_at is null
       order by x.created_at desc
       limit 1
    ) l on true
   where m.user_id = p_user
     and m.conversation_id = any (p_conv_ids);
$$;

revoke all on function public.dm_inbox_summary(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.dm_inbox_summary(uuid, uuid[]) to service_role;

-- 6. Durable send-rate check ------------------------------------------------
-- src/lib/rate-limit.ts is per-lambda, so it does not hold across Vercel
-- instances. The send route now also asks the database how many messages
-- this sender wrote recently.
create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
-- the new index leads with sender_id, so the single-column one is redundant
drop index if exists public.idx_messages_sender_id;

-- 7. Backup tables flagged by the security advisor -------------------------
-- No anon/authenticated grants exist on these, but RLS was off. Turning it on
-- (with no policies) silences the advisor without touching the data.
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like '\_backup\_%'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
