-- 033_profile_social_expansion.sql
-- Profile experience expansion for MM Social. Adds the data layer behind the
-- new tabbed profile: Birthday, Family (a label on existing follows), Saves
-- (bookmarks), Shared (reshares), and Liked photos.
--
-- Design choices (per product decision):
--   * Friends / Family reuse the existing one-directional follows graph rather
--     than a new request/accept system. "Friends" = mutual follows (a pair of
--     reciprocal follows rows). "Family" = an optional label the owner applies
--     to someone they follow, stored in contact_labels.
--   * Saves and Reshares are POLYMORPHIC over content types (video/photo) so we
--     don't need a new table per content kind. target_type gates target_id.
--   * All new server routes use the service-role client (bypasses RLS); the RLS
--     policies below still cover any direct authenticated/anon access.

-- ===========================================================================
-- 1) Profile fields: birthday (+ visibility) and city
-- ===========================================================================
alter table public.profiles
  add column if not exists birth_date date,
  add column if not exists birthday_visible boolean not null default true,
  add column if not exists city text;

comment on column public.profiles.birth_date is
  'Optional date of birth. Only month/day are surfaced publicly on the Birthday tab; the year stays private.';
comment on column public.profiles.birthday_visible is
  'When false, the Birthday tab is hidden from other members even if birth_date is set.';

-- ===========================================================================
-- 2) contact_labels — apply "family" (or future labels) to someone you follow
-- ===========================================================================
-- owner_id labels contact_id. Reuses the follow graph for the underlying
-- relationship; this table only carries the categorization.
create table if not exists public.contact_labels (
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (label in ('family')),
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id, label),
  constraint contact_labels_no_self check (owner_id <> contact_id)
);

create index if not exists contact_labels_owner_idx
  on public.contact_labels (owner_id, label);

alter table public.contact_labels enable row level security;

-- A member's labels are private to them (family list is not public).
drop policy if exists contact_labels_select_own on public.contact_labels;
create policy contact_labels_select_own on public.contact_labels
  for select using (auth.uid() = owner_id);

drop policy if exists contact_labels_insert_own on public.contact_labels;
create policy contact_labels_insert_own on public.contact_labels
  for insert with check (auth.uid() = owner_id);

drop policy if exists contact_labels_delete_own on public.contact_labels;
create policy contact_labels_delete_own on public.contact_labels
  for delete using (auth.uid() = owner_id);

-- ===========================================================================
-- 3) content_saves — bookmark a video or photo ("Saves" tab)
-- ===========================================================================
create table if not exists public.content_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('video', 'photo')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index if not exists content_saves_user_idx
  on public.content_saves (user_id, created_at desc);

alter table public.content_saves enable row level security;

-- Saves are private to the saver.
drop policy if exists content_saves_select_own on public.content_saves;
create policy content_saves_select_own on public.content_saves
  for select using (auth.uid() = user_id);

drop policy if exists content_saves_insert_own on public.content_saves;
create policy content_saves_insert_own on public.content_saves
  for insert with check (auth.uid() = user_id);

drop policy if exists content_saves_delete_own on public.content_saves;
create policy content_saves_delete_own on public.content_saves
  for delete using (auth.uid() = user_id);

-- ===========================================================================
-- 4) content_reshares — reshare a video or photo to your profile ("Shared" tab)
-- ===========================================================================
create table if not exists public.content_reshares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('video', 'photo')),
  target_id uuid not null,
  caption text,
  created_at timestamptz not null default now(),
  -- One reshare of a given item per user (re-sharing again is idempotent).
  unique (user_id, target_type, target_id)
);

create index if not exists content_reshares_user_idx
  on public.content_reshares (user_id, created_at desc);

alter table public.content_reshares enable row level security;

-- Reshares are PUBLIC-read (they appear on the sharer's public profile), but
-- only the owner may create/delete their own.
drop policy if exists content_reshares_select_all on public.content_reshares;
create policy content_reshares_select_all on public.content_reshares
  for select using (true);

drop policy if exists content_reshares_insert_own on public.content_reshares;
create policy content_reshares_insert_own on public.content_reshares
  for insert with check (auth.uid() = user_id);

drop policy if exists content_reshares_delete_own on public.content_reshares;
create policy content_reshares_delete_own on public.content_reshares
  for delete using (auth.uid() = user_id);

-- ===========================================================================
-- 5) profile_gallery_likes — like a gallery photo ("Liked" tab source)
-- ===========================================================================
create table if not exists public.profile_gallery_likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  gallery_id uuid not null references public.profile_gallery(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, gallery_id)
);

create index if not exists profile_gallery_likes_user_idx
  on public.profile_gallery_likes (user_id, created_at desc);
create index if not exists profile_gallery_likes_gallery_idx
  on public.profile_gallery_likes (gallery_id);

alter table public.profile_gallery_likes enable row level security;

-- Public-read (so like counts / who-liked can render); owner-only writes.
drop policy if exists profile_gallery_likes_select_all on public.profile_gallery_likes;
create policy profile_gallery_likes_select_all on public.profile_gallery_likes
  for select using (true);

drop policy if exists profile_gallery_likes_insert_own on public.profile_gallery_likes;
create policy profile_gallery_likes_insert_own on public.profile_gallery_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists profile_gallery_likes_delete_own on public.profile_gallery_likes;
create policy profile_gallery_likes_delete_own on public.profile_gallery_likes
  for delete using (auth.uid() = user_id);

-- Denormalized like count on the gallery photo, kept in sync by trigger so the
-- grid can render counts without a COUNT(*) per tile.
alter table public.profile_gallery
  add column if not exists likes_count int not null default 0;

create or replace function public.sync_gallery_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profile_gallery
      set likes_count = coalesce(likes_count, 0) + 1
      where id = new.gallery_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.profile_gallery
      set likes_count = greatest(coalesce(likes_count, 0) - 1, 0)
      where id = old.gallery_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_gallery_likes_count on public.profile_gallery_likes;
create trigger trg_gallery_likes_count
  after insert or delete on public.profile_gallery_likes
  for each row execute function public.sync_gallery_likes_count();
