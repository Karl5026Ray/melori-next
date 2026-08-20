-- 045_remove_empty_king_gallery.sql
-- Removes the leftover "KING" gallery/folder, which holds no photos and so
-- renders as a blank tile on /gallery.
--
-- Deliberately non-destructive: every delete below is guarded on the row
-- having ZERO associated images, so if "KING" ever gains photos this migration
-- becomes a no-op instead of destroying client work.
--
-- Idempotent; safe to re-run.

-- Empty "KING" folder inside any gallery.
delete from public.photo_gallery_folders f
  where upper(trim(f.name)) = 'KING'
    and not exists (
      select 1 from public.photo_gallery_images i where i.folder_id = f.id
    );

-- Empty "KING" gallery itself (cascades to its folders, which are also empty).
delete from public.photo_galleries g
  where upper(trim(g.name)) = 'KING'
    and not exists (
      select 1 from public.photo_gallery_images i where i.gallery_id = g.id
    );
