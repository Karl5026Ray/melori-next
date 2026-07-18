-- 034_profile_gallery_comments.sql
-- Comments on gallery photos, mirroring the social_video_comments model so the
-- profile content viewer can support commenting on photos just like reels.
--
--   * profile_gallery_comments — one row per comment on a gallery item.
--   * profile_gallery.comments_count — denormalized counter, trigger-synced,
--     so photo tiles/badges can render a count without a COUNT(*) per tile.
--
-- Idempotent; safe to re-run.

create table if not exists public.profile_gallery_comments (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.profile_gallery(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_gallery_comments_gallery_idx
  on public.profile_gallery_comments (gallery_id, created_at desc);
create index if not exists profile_gallery_comments_user_idx
  on public.profile_gallery_comments (user_id);

alter table public.profile_gallery_comments enable row level security;

-- Public-read (comments show on any profile the photo belongs to); a signed-in
-- user may add their own comment and delete only their own.
drop policy if exists profile_gallery_comments_select_all on public.profile_gallery_comments;
create policy profile_gallery_comments_select_all on public.profile_gallery_comments
  for select using (true);

drop policy if exists profile_gallery_comments_insert_own on public.profile_gallery_comments;
create policy profile_gallery_comments_insert_own on public.profile_gallery_comments
  for insert with check (auth.uid() = user_id);

drop policy if exists profile_gallery_comments_delete_own on public.profile_gallery_comments;
create policy profile_gallery_comments_delete_own on public.profile_gallery_comments
  for delete using (auth.uid() = user_id);

-- Denormalized comment count on the gallery photo.
alter table public.profile_gallery
  add column if not exists comments_count int not null default 0;

create or replace function public.sync_gallery_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profile_gallery
      set comments_count = coalesce(comments_count, 0) + 1
      where id = new.gallery_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.profile_gallery
      set comments_count = greatest(coalesce(comments_count, 0) - 1, 0)
      where id = old.gallery_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_gallery_comments_count on public.profile_gallery_comments;
create trigger trg_gallery_comments_count
  after insert or delete on public.profile_gallery_comments
  for each row execute function public.sync_gallery_comments_count();
