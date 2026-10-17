-- 099: close the gallery password bypass (2026-10-17).
--
-- photo_galleries_public_read let anon/authenticated SELECT every column,
-- including password_hash, and the unlock cookie WAS that hash. Anyone with the
-- public anon key could read it and walk into a private gallery. The images and
-- folders of private galleries were readable the same way.
--
-- 1. Column-level grants: clients can read every gallery column except
--    password_hash. Server code uses the service role and is unaffected.
-- 2. Images and folders of password-protected galleries are no longer
--    publicly readable. Owners keep full access via the *_owner_all policies.
-- The policies call a SECURITY DEFINER helper: a policy subquery runs as the
-- caller, and the caller can no longer read password_hash.
-- The cookie itself is now a server-signed HMAC (src/lib/gallery-auth.ts).

revoke select on public.photo_galleries from anon, authenticated;
grant select (
  id, photographer_id, client_name, name, slug, cover_image_key,
  allow_downloads, is_active, view_count, created_at
) on public.photo_galleries to anon, authenticated;

create or replace function public.gallery_is_public(p_gallery_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.photo_galleries g
    where g.id = p_gallery_id
      and g.is_active = true
      and g.password_hash is null
  );
$$;
revoke all on function public.gallery_is_public(uuid) from public;
grant execute on function public.gallery_is_public(uuid) to anon, authenticated;

drop policy if exists photo_gallery_images_public_read on public.photo_gallery_images;
create policy photo_gallery_images_public_read on public.photo_gallery_images
  for select using (public.gallery_is_public(gallery_id));

drop policy if exists photo_gallery_folders_public_read on public.photo_gallery_folders;
create policy photo_gallery_folders_public_read on public.photo_gallery_folders
  for select using (public.gallery_is_public(gallery_id));
