-- 035_photo_gallery.sql
-- Photographer photo-gallery feature: client-delivery galleries with optional
-- password gating, folder sub-grouping, watermarked public previews, and
-- per-image digital-download sales via Stripe.
--
--   * photo_galleries        — one row per delivered gallery (owned by a photographer).
--   * photo_gallery_folders  — optional sub-grouping inside a gallery (e.g. "Ceremony").
--   * photo_gallery_images   — one row per photo; ORIGINAL lives in a private bucket,
--                              watermarked preview + thumb live in a public bucket.
--   * photo_gallery_purchases— one row per paid digital download (Stripe-fulfilled).
--   * gallery_api_keys       — CLI auth; stores a sha256 HASH of the key, never the raw key.
--
-- Storage buckets are created out-of-band (no existing migration touches
-- storage.buckets), so this file does NOT create them. Create manually:
--   * gallery-originals  (PRIVATE) — full-res clean originals.
--   * gallery-previews   (PUBLIC)  — watermarked previews + thumbnails.
--
-- Idempotent; safe to re-run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.photo_galleries (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references auth.users(id) on delete cascade,
  client_name text,
  name text not null,
  slug text unique not null,
  cover_image_key text,
  password_hash text,
  allow_downloads boolean not null default true,
  is_active boolean not null default true,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.photo_gallery_folders (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.photo_galleries(id) on delete cascade,
  name text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.photo_gallery_images (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.photo_galleries(id) on delete cascade,
  folder_id uuid references public.photo_gallery_folders(id) on delete set null,
  storage_key text not null,            -- ORIGINAL full-res, PRIVATE bucket
  preview_key text not null,            -- WATERMARKED preview, public bucket
  thumbnail_key text not null,          -- watermarked thumb, public bucket
  blur_hash text,
  caption text,
  filename text,
  order_index integer not null default 0,
  for_sale boolean not null default false,
  price_cents integer,                  -- digital download price
  download_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.photo_gallery_purchases (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.photo_gallery_images(id) on delete cascade,
  gallery_id uuid not null references public.photo_galleries(id) on delete cascade,
  buyer_user_id uuid references auth.users(id) on delete set null,  -- nullable: guest checkout allowed
  buyer_email text,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  amount_cents integer,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);

create table if not exists public.gallery_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text unique not null,        -- sha256 hex of the raw key
  name text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists photo_gallery_images_gallery_idx
  on public.photo_gallery_images (gallery_id, order_index);
create index if not exists photo_gallery_images_folder_idx
  on public.photo_gallery_images (folder_id);
create index if not exists photo_gallery_folders_gallery_idx
  on public.photo_gallery_folders (gallery_id, order_index);
create index if not exists photo_gallery_purchases_image_idx
  on public.photo_gallery_purchases (image_id);
create index if not exists photo_gallery_purchases_session_idx
  on public.photo_gallery_purchases (stripe_session_id);
create index if not exists gallery_api_keys_hash_idx
  on public.gallery_api_keys (key_hash);
create index if not exists photo_galleries_photographer_idx
  on public.photo_galleries (photographer_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- All service-role routes bypass RLS, but we still scope anon/authenticated
-- access defensively: owners get full control of their own rows, the public
-- may read only images/galleries belonging to ACTIVE galleries, and purchases
-- + api-keys are entirely off-limits to anon (service-role only).
-- ---------------------------------------------------------------------------

alter table public.photo_galleries        enable row level security;
alter table public.photo_gallery_folders  enable row level security;
alter table public.photo_gallery_images   enable row level security;
alter table public.photo_gallery_purchases enable row level security;
alter table public.gallery_api_keys        enable row level security;

-- photo_galleries: owner-all + public-read of active galleries.
drop policy if exists photo_galleries_owner_all on public.photo_galleries;
create policy photo_galleries_owner_all on public.photo_galleries
  for all using (photographer_id = auth.uid())
  with check (photographer_id = auth.uid());

drop policy if exists photo_galleries_public_read on public.photo_galleries;
create policy photo_galleries_public_read on public.photo_galleries
  for select using (is_active = true);

-- photo_gallery_folders: owner-all via parent gallery + public-read for active.
drop policy if exists photo_gallery_folders_owner_all on public.photo_gallery_folders;
create policy photo_gallery_folders_owner_all on public.photo_gallery_folders
  for all using (
    exists (
      select 1 from public.photo_galleries g
      where g.id = photo_gallery_folders.gallery_id
        and g.photographer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.photo_galleries g
      where g.id = photo_gallery_folders.gallery_id
        and g.photographer_id = auth.uid()
    )
  );

drop policy if exists photo_gallery_folders_public_read on public.photo_gallery_folders;
create policy photo_gallery_folders_public_read on public.photo_gallery_folders
  for select using (
    exists (
      select 1 from public.photo_galleries g
      where g.id = photo_gallery_folders.gallery_id
        and g.is_active = true
    )
  );

-- photo_gallery_images: owner-all via parent gallery + public-read for active.
drop policy if exists photo_gallery_images_owner_all on public.photo_gallery_images;
create policy photo_gallery_images_owner_all on public.photo_gallery_images
  for all using (
    exists (
      select 1 from public.photo_galleries g
      where g.id = photo_gallery_images.gallery_id
        and g.photographer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.photo_galleries g
      where g.id = photo_gallery_images.gallery_id
        and g.photographer_id = auth.uid()
    )
  );

drop policy if exists photo_gallery_images_public_read on public.photo_gallery_images;
create policy photo_gallery_images_public_read on public.photo_gallery_images
  for select using (
    exists (
      select 1 from public.photo_galleries g
      where g.id = photo_gallery_images.gallery_id
        and g.is_active = true
    )
  );

-- photo_gallery_purchases: no anon access. Owner may read their own purchases;
-- everything else (inserts, guest purchases) goes through the service role.
drop policy if exists photo_gallery_purchases_owner_read on public.photo_gallery_purchases;
create policy photo_gallery_purchases_owner_read on public.photo_gallery_purchases
  for select using (buyer_user_id = auth.uid());

-- gallery_api_keys: service-role only. No public policies — RLS enabled with no
-- permissive policy denies all anon/authenticated access by default.

-- ---------------------------------------------------------------------------
-- View-count helper (atomic increment used by the public viewer).
-- ---------------------------------------------------------------------------

create or replace function public.increment_gallery_view_count(p_gallery_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.photo_galleries
    set view_count = view_count + 1
    where id = p_gallery_id;
$$;

create or replace function public.increment_gallery_download_count(p_image_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.photo_gallery_images
    set download_count = download_count + 1
    where id = p_image_id;
$$;
