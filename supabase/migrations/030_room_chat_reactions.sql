-- 030_room_chat_reactions.sql
-- Inline emoji reactions on room chat messages (space_comments), shared by every
-- live room type via RoomChat. One row per (message, user, emoji); the unique
-- constraint makes a reaction idempotent so a double-tap can't double-count.
-- Toggling off is a DELETE of that row.
--
-- Real-time sync reuses the SAME mechanism the chat feed already uses: Supabase
-- Realtime postgres_changes on this table (INSERT + DELETE), rather than a
-- LiveKit data channel. Rationale: RoomChat is LiveKit-agnostic (it only knows
-- spaceId and is reused by Spaces, Faces and Connect), and the message feed
-- itself already fans out via postgres_changes on space_comments — piggybacking
-- reactions on the identical path keeps the shared component decoupled from any
-- one transport and gives durable persistence + live sync in one write. The
-- Faces "flying hearts" (room-level, ephemeral) keep their existing Supabase
-- broadcast channel and are untouched.
--
-- REPLICA IDENTITY FULL is required so DELETE events carry comment_id / user_id
-- / emoji (not just the PK), letting every client remove the right reaction when
-- someone toggles theirs off.

create table if not exists public.space_comment_reactions (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.space_comments(id) on delete cascade,
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);

create index if not exists idx_space_comment_reactions_comment
  on public.space_comment_reactions(comment_id);
create index if not exists idx_space_comment_reactions_space
  on public.space_comment_reactions(space_id, created_at);

alter table public.space_comment_reactions replica identity full;

alter table public.space_comment_reactions enable row level security;

-- Public read: reactions are visible to anyone who can see the room (mirrors the
-- "Public read space comments" policy). Writes go through the reactions API
-- route with the service-role client after the auth guard, so no client INSERT/
-- DELETE policy is opened here.
drop policy if exists "Public read space comment reactions" on public.space_comment_reactions;
create policy "Public read space comment reactions"
  on public.space_comment_reactions for select
  using (true);

-- Admins can moderate, mirroring space_comments.
drop policy if exists "Admins all access space_comment_reactions" on public.space_comment_reactions;
create policy "Admins all access space_comment_reactions"
  on public.space_comment_reactions for all
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ));

-- Ensure the table is broadcast over Supabase Realtime. Guarded so it is a
-- no-op when the publication is already FOR ALL TABLES or already includes it.
do $$
begin
  alter publication supabase_realtime add table public.space_comment_reactions;
exception
  when duplicate_object then null;
  when undefined_object then null; -- publication not present in this env
end $$;
