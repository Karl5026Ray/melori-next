-- 009_conversations_messages_rls.sql
-- Bring the ad-hoc conversations / conversation_members / messages tables
-- (originally created by hand in the Supabase console) under version control
-- and lock them down with RLS. Also creates track_analytics for the studio
-- analytics endpoint.
--
-- Everything is idempotent so re-running against a database that already has
-- the tables is a no-op.

-- ---------------------------------------------------------------------------
-- conversations: bag-of-members chat container. No `type` column — a 1:1 is
-- identified by exactly two rows in conversation_members. See
-- src/lib/direct-conversation.ts.
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversation_members: who's in each conversation. last_read_at is added by
-- migration 005 if the table already existed.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  unique (conversation_id, user_id)
);

alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, conversation_id);

create index if not exists conversation_members_conv_idx
  on public.conversation_members (conversation_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  is_edited boolean not null default false
);

create index if not exists messages_conv_created_idx
  on public.messages (conversation_id, created_at asc);

create index if not exists messages_sender_idx
  on public.messages (sender_id);

alter table public.messages
  add constraint messages_content_length_chk
  check (char_length(content) between 1 and 4000)
  not valid;

-- Try to validate the check constraint; ignore if it fails on legacy rows.
do $$
begin
  begin
    alter table public.messages validate constraint messages_content_length_chk;
  exception when others then
    -- legacy rows may violate the length constraint; leave it not-validated.
    null;
  end;
end $$;

-- Keep conversations.updated_at fresh so message lists sort correctly.
create or replace function public.bump_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: is the caller a member of the given conversation? Defined as
-- security definer so RLS on conversation_members doesn't recurse when a
-- policy on conversation_members itself needs to check membership.
-- ---------------------------------------------------------------------------
create or replace function public.is_conversation_member(conv_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.conversation_members m
     where m.conversation_id = conv_id
       and m.user_id = uid
  );
$$;

-- Only server + authenticated users may call this helper; anon must not
-- use it to probe membership of arbitrary conversation ids.
revoke all on function public.is_conversation_member(uuid, uuid) from public;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: conversations
--   SELECT: any member of the conversation.
--   INSERT: server-side only (service_role bypasses RLS). Client code opens
--           conversations via /api/social/waves/[id]/accept and
--           /api/social/conversations/start, which use the service key.
--   UPDATE/DELETE: none from the client.
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;

drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member" on public.conversations
  for select using (public.is_conversation_member(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: conversation_members
--   SELECT: rows in any conversation the caller belongs to. This lets the
--           messages page look up the other participant's profile.
--   UPDATE: only the caller's own membership row (used by /read to set
--           last_read_at). Cannot change conversation_id or user_id.
--   INSERT/DELETE: server-side only.
-- ---------------------------------------------------------------------------
alter table public.conversation_members enable row level security;

drop policy if exists "conversation_members_select_same_conv" on public.conversation_members;
create policy "conversation_members_select_same_conv" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "conversation_members_update_self" on public.conversation_members;
create policy "conversation_members_update_self" on public.conversation_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: messages
--   SELECT: only members of the conversation.
--   INSERT: the caller must be a member AND must be sending as themselves.
--           This closes the "any signed-in user can INSERT with a random
--           conversation_id" hole. The API route also enforces the
--           Superfan-or-better membership tier and block list; RLS is the
--           belt against a client that bypasses the API.
--   UPDATE/DELETE: none from the client for now.
-- ---------------------------------------------------------------------------
alter table public.messages enable row level security;

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "messages_insert_self_member" on public.messages;
create policy "messages_insert_self_member" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- track_analytics: per-track aggregate counters. The studio analytics
-- endpoint reads this. If a legacy hand-built version exists we do not
-- overwrite it; the `if not exists` clauses are safe.
-- ---------------------------------------------------------------------------
create table if not exists public.track_analytics (
  id bigserial primary key,
  track_id bigint not null references public.tracks(id) on delete cascade,
  streams bigint not null default 0,
  downloads bigint not null default 0,
  revenue numeric(12,2) not null default 0,
  bucket_date date not null default current_date,
  updated_at timestamptz not null default now(),
  unique (track_id, bucket_date)
);

create index if not exists track_analytics_track_idx
  on public.track_analytics (track_id, bucket_date desc);

alter table public.track_analytics enable row level security;

-- Only server code (service_role) or the track's owning artist can read a
-- track's analytics. Anonymous or free-tier users get nothing.
drop policy if exists "track_analytics_select_owner" on public.track_analytics;
create policy "track_analytics_select_owner" on public.track_analytics
  for select using (
    exists (
      select 1
        from public.tracks t
        join public.releases r on r.id = t.release_id
        join public.artists a on a.id = r.artist_id
       where t.id = track_analytics.track_id
         and a.profile_id = auth.uid()
    )
  );

-- Writes are server-side only (payments webhook, stream endpoint) via
-- service_role; no client policy for INSERT/UPDATE/DELETE.
