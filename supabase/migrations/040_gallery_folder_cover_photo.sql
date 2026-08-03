-- 040_gallery_folder_cover_photo.sql
-- Explicit cover photo per gallery folder/category. Until now the public
-- gallery viewer used each folder's first photo as its cover tile; this lets
-- the photographer pick one. Nullable — null keeps the first-photo fallback.
--
-- Idempotent; safe to re-run.

alter table public.photo_gallery_folders
  add column if not exists cover_photo_id uuid
    references public.photo_gallery_images(id) on delete set null;

comment on column public.photo_gallery_folders.cover_photo_id is
  'Photo shown as this folder''s cover tile. Null falls back to the folder''s first photo by order_index.';

create index if not exists photo_gallery_folders_cover_photo_idx
  on public.photo_gallery_folders (cover_photo_id);
