-- 018_profile_gallery.sql
-- Per-account photo gallery (up to 12 photos) for superfan/artist members.
-- Public read; owner-only writes. Images live in the existing public `covers`
-- bucket under gallery/{userId}/… . Server routes use the service-role client
-- (bypasses RLS); the policies below cover any direct anon/authenticated access.

create table if not exists public.profile_gallery (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists profile_gallery_profile_idx
  on public.profile_gallery(profile_id, sort_order);

alter table public.profile_gallery enable row level security;

-- public read
drop policy if exists "gallery_public_read" on public.profile_gallery;
create policy "gallery_public_read" on public.profile_gallery
  for select using (true);

-- owner can insert/update/delete their own rows
drop policy if exists "gallery_owner_insert" on public.profile_gallery;
create policy "gallery_owner_insert" on public.profile_gallery
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists "gallery_owner_update" on public.profile_gallery;
create policy "gallery_owner_update" on public.profile_gallery
  for update to authenticated using (profile_id = auth.uid());

drop policy if exists "gallery_owner_delete" on public.profile_gallery;
create policy "gallery_owner_delete" on public.profile_gallery
  for delete to authenticated using (profile_id = auth.uid());
