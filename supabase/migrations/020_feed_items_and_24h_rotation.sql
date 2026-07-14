-- 020_feed_items_and_24h_rotation.sql
-- =============================================================================
-- Melori Mirror: 24-hour feed rotation + unified feed_items table.
--
-- This lands the "24-hour rotation" architecture from the Kimi feed-architecture
-- review, using Supabase Storage for media (no Mux). Two parts:
--
--   PART A  Add expiry to the existing social_videos feed so Mirror content
--           rotates out after 24h, with an archive table so nothing is
--           destroyed and a pg_cron job that sweeps expired rows into it.
--
--   PART B  A unified `feed_items` table for future multi-type feed content
--           (video / audio / news / text / image), with the same 24h expiry +
--           archive + pg_cron rotation and RLS.
--
-- pg_cron and pg_net are already installed on this project.
-- Idempotent: safe to re-run.
-- =============================================================================

-- Rotation window. One place to change if we ever want a different TTL.
-- (24 hours per the Mirror "For You" rotation design.)

-- ----------------------------------------------------------------------------
-- PART A — 24h rotation for social_videos (the current Mirror video feed)
-- ----------------------------------------------------------------------------

-- 1. expires_at column. Existing rows (there are 0 today) and any row that omits
--    it get created_at + 24h via the trigger below. We keep the column plain
--    (no DB default expression referencing another column, which Postgres
--    disallows) and fill it with a BEFORE INSERT trigger.
alter table public.social_videos
  add column if not exists expires_at timestamptz;

create or replace function public.set_feed_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.expires_at is null then
    new.expires_at := coalesce(new.created_at, now()) + interval '24 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_videos_expiry on public.social_videos;
create trigger trg_social_videos_expiry
  before insert on public.social_videos
  for each row execute function public.set_feed_expiry();

-- Backfill any pre-existing rows so the rotation filter is well-defined.
update public.social_videos
  set expires_at = created_at + interval '24 hours'
  where expires_at is null;

-- Partial-friendly index for the "still-live, newest first" read path used by
-- /api/mirror/feed (keyset on created_at DESC, id DESC, filtered by expiry).
create index if not exists idx_social_videos_expires_at
  on public.social_videos (expires_at);
create index if not exists idx_social_videos_feed_keyset
  on public.social_videos (created_at desc, id desc);

-- Archive table: expired posts move here rather than being deleted, so they can
-- be restored, audited, or surfaced in a "past posts" view later.
create table if not exists public.social_videos_archive (
  like public.social_videos including defaults,
  archived_at timestamptz not null default now()
);

-- Sweep: move expired rows out of the live table into the archive.
create or replace function public.rotate_expired_social_videos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  with expired as (
    delete from public.social_videos
      where expires_at is not null and expires_at <= now()
      returning *
  )
  insert into public.social_videos_archive
    (id, user_id, title, description, video_url, thumbnail_url,
     likes_count, comments_count, created_at, media_type, expires_at)
  select
    id, user_id, title, description, video_url, thumbnail_url,
    likes_count, comments_count, created_at, media_type, expires_at
  from expired;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- ----------------------------------------------------------------------------
-- PART B — unified feed_items table (future multi-type Mirror content)
-- ----------------------------------------------------------------------------
-- type      : 'video' | 'audio' | 'image' | 'text' | 'news'
-- author_id : profiles.id (null allowed for system/news items)
-- content   : jsonb payload (title, body, links, poster, etc.) — flexible so we
--             don't re-migrate every time a new card shape appears.
-- media_url : Supabase Storage public URL for the primary media (nullable).
-- created_at / expires_at : same 24h rotation as Part A.

create table if not exists public.feed_items (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'video'
                check (type in ('video','audio','image','text','news')),
  author_id   uuid references public.profiles(id) on delete set null,
  content     jsonb not null default '{}'::jsonb,
  media_url   text,
  thumbnail_url text,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz
);

-- Reuse the shared expiry trigger (created_at + 24h when omitted).
drop trigger if exists trg_feed_items_expiry on public.feed_items;
create trigger trg_feed_items_expiry
  before insert on public.feed_items
  for each row execute function public.set_feed_expiry();

create index if not exists idx_feed_items_expires_at
  on public.feed_items (expires_at);
create index if not exists idx_feed_items_keyset
  on public.feed_items (created_at desc, id desc);
create index if not exists idx_feed_items_type
  on public.feed_items (type);

-- Archive for expired feed_items.
create table if not exists public.feed_items_archive (
  like public.feed_items including defaults,
  archived_at timestamptz not null default now()
);

create or replace function public.rotate_expired_feed_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  with expired as (
    delete from public.feed_items
      where expires_at is not null and expires_at <= now()
      returning *
  )
  insert into public.feed_items_archive
    (id, type, author_id, content, media_url, thumbnail_url,
     likes_count, comments_count, created_at, expires_at)
  select
    id, type, author_id, content, media_url, thumbnail_url,
    likes_count, comments_count, created_at, expires_at
  from expired;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- RLS: feed_items is world-readable (only non-expired rows are meaningful, and
-- the read path filters by expiry), authors may insert/update/delete their own.
alter table public.feed_items enable row level security;

drop policy if exists "feed_items read (public)" on public.feed_items;
create policy "feed_items read (public)"
  on public.feed_items for select
  using (true);

drop policy if exists "feed_items insert own" on public.feed_items;
create policy "feed_items insert own"
  on public.feed_items for insert
  with check (auth.uid() = author_id);

drop policy if exists "feed_items update own" on public.feed_items;
create policy "feed_items update own"
  on public.feed_items for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "feed_items delete own" on public.feed_items;
create policy "feed_items delete own"
  on public.feed_items for delete
  using (auth.uid() = author_id);

-- Archive table is server/admin only (no policies -> only service role reaches it).
alter table public.feed_items_archive enable row level security;
alter table public.social_videos_archive enable row level security;

-- ----------------------------------------------------------------------------
-- pg_cron — sweep both tables every 10 minutes. Unschedule first so re-running
-- this migration doesn't create duplicate jobs.
-- ----------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('rotate-social-videos');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('rotate-feed-items');
exception when others then null;
end $$;

select cron.schedule(
  'rotate-social-videos',
  '*/10 * * * *',
  $$select public.rotate_expired_social_videos();$$
);

select cron.schedule(
  'rotate-feed-items',
  '*/10 * * * *',
  $$select public.rotate_expired_feed_items();$$
);
