-- 039_gallery_folder_hierarchy.sql
--
-- Add parent-child hierarchy to photo_gallery_folders so the browser
-- Studio upload panel can accept a dragged folder tree (Finder/Explorer)
-- and preserve the directory structure inside the gallery.
--
-- Backward compatible: parent_folder_id NULL == top-level folder, which
-- matches every folder row that exists today.
--
-- Idempotent: safe to re-run.

alter table public.photo_gallery_folders
  add column if not exists parent_folder_id uuid
    references public.photo_gallery_folders(id) on delete cascade;

-- Unique folder name within its (gallery, parent) scope so re-uploads to
-- the same tree reuse existing folders instead of duplicating.
-- Using COALESCE trick because PG treats NULLs as distinct in unique
-- constraints; nullable parent_folder_id is legitimate (top-level).
create unique index if not exists photo_gallery_folders_unique_name_in_scope
  on public.photo_gallery_folders (
    gallery_id,
    coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name
  );

-- Fast lookup of children of a folder.
create index if not exists photo_gallery_folders_parent_idx
  on public.photo_gallery_folders (gallery_id, parent_folder_id);
