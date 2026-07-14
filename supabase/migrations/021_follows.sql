-- Member-to-member follows for MM Social.
-- One-directional model (like Spotify / X / SoundCloud): a row
-- (follower_id, following_id) means follower_id follows following_id.
-- This lights up the previously-dormant profiles.followers_count /
-- following_count columns. Mutual "friends" can be layered on later by
-- treating a pair of reciprocal rows as a friendship.
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  -- You cannot follow yourself.
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx
  on public.follows (following_id);

alter table public.follows enable row level security;

-- Follow graph is public-read (needed to show follower lists / counts), but
-- a user may only create/delete rows where THEY are the follower.
drop policy if exists follows_select_all on public.follows;
create policy follows_select_all on public.follows
  for select using (true);

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete using (auth.uid() = follower_id);

-- ---------------------------------------------------------------------------
-- Keep profiles.followers_count / following_count in sync automatically so the
-- UI can read denormalized counts without a COUNT(*) on every profile view.
-- ---------------------------------------------------------------------------
create or replace function public.follows_apply_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profiles
      set following_count = coalesce(following_count, 0) + 1
      where id = new.follower_id;
    update public.profiles
      set followers_count = coalesce(followers_count, 0) + 1
      where id = new.following_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.profiles
      set following_count = greatest(coalesce(following_count, 0) - 1, 0)
      where id = old.follower_id;
    update public.profiles
      set followers_count = greatest(coalesce(followers_count, 0) - 1, 0)
      where id = old.following_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists follows_counts_trg on public.follows;
create trigger follows_counts_trg
  after insert or delete on public.follows
  for each row execute function public.follows_apply_counts();

-- Backfill counts from any pre-existing rows (idempotent-safe on fresh DBs).
update public.profiles p set
  followers_count = (select count(*) from public.follows f where f.following_id = p.id),
  following_count = (select count(*) from public.follows f where f.follower_id = p.id);
