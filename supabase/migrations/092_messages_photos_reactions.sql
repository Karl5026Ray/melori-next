-- 092_messages_photos_reactions
--
-- Messages quick wins (2026-10-06): photos in DMs and message reactions.
-- Additive only — no drops — so it can be applied before or after the app
-- code ships.
--
-- PHOTOS
--   messages.attachments is a JSON array, e.g.
--     [{"type":"image","path":"<conversationId>/<senderId>/<uuid>.jpg",
--       "width":1200,"height":900}]
--   Files live in the PRIVATE bucket `message-media`. Uploads only happen
--   through a server-issued signed upload URL (POST
--   /api/social/messages/upload-url checks membership and pins the path to
--   <conversationId>/<callerId>/). Members of the conversation may read
--   (createSignedUrl) through the storage.objects policy below; nobody else.
--
-- REACTIONS
--   message_reactions: one row per (message, member, emoji). Written only by
--   the server (POST /api/social/messages/[id]/reactions); members read them
--   through RLS. Live updates go over the conversation's PRIVATE realtime
--   channel (a "reaction" broadcast), not postgres_changes — DELETE events
--   from postgres_changes are not RLS-filtered, so the table is deliberately
--   NOT added to the supabase_realtime publication.

-- 1. Photos on messages -------------------------------------------------------
alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachments_array_chk') then
    alter table public.messages
      add constraint messages_attachments_array_chk
      check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4);
  end if;
end $$;

-- Deleting a message clears its photos as well as its text (extends the
-- 090 trigger function; same trigger, same name).
create or replace function public.messages_scrub_on_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    new.content := '';
    new.attachments := '[]'::jsonb;
  end if;
  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-media', 'message-media', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- <conversationId>/<senderId>/<file> → readable by members of that conversation.
create or replace function public.can_read_message_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then exists (
      select 1 from public.conversation_members m
       where m.conversation_id = split_part(p_name, '/', 1)::uuid
         and m.user_id = (select auth.uid())
    )
    else false
  end;
$$;
revoke all on function public.can_read_message_media(text) from public, anon;
grant execute on function public.can_read_message_media(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'message_media_read_member'
  ) then
    create policy message_media_read_member on storage.objects
      for select to authenticated
      using (bucket_id = 'message-media' and public.can_read_message_media(name));
  end if;
end $$;

-- 2. Reactions ----------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);

alter table public.message_reactions enable row level security;
revoke all on table public.message_reactions from public, anon, authenticated;
grant select on table public.message_reactions to authenticated;
grant all on table public.message_reactions to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'message_reactions'
       and policyname = 'message_reactions_select_member'
  ) then
    create policy message_reactions_select_member on public.message_reactions
      for select to authenticated
      using (exists (
        select 1 from public.messages msg
         where msg.id = message_id
           and public.is_conversation_member(msg.conversation_id)
      ));
  end if;
end $$;
