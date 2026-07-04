-- Member-to-member blocks for MM Social direct messages.
-- A row (blocker_id, blocked_id) means blocker_id will not receive/allow DMs
-- with blocked_id in either direction.
create table if not exists public.member_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create index if not exists member_blocks_blocked_id_idx
  on public.member_blocks (blocked_id);

alter table public.member_blocks enable row level security;

-- Users can see and manage only the block rows they created.
drop policy if exists member_blocks_select_own on public.member_blocks;
create policy member_blocks_select_own on public.member_blocks
  for select using (auth.uid() = blocker_id);

drop policy if exists member_blocks_insert_own on public.member_blocks;
create policy member_blocks_insert_own on public.member_blocks
  for insert with check (auth.uid() = blocker_id);

drop policy if exists member_blocks_delete_own on public.member_blocks;
create policy member_blocks_delete_own on public.member_blocks
  for delete using (auth.uid() = blocker_id);
