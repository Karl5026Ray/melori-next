-- 041_mirror_youtube_sources.sql
-- =============================================================================
-- Melori Mirror: YouTube posts + archive-on-delete.
--
-- PART A  social_videos gains a `source` discriminator ('upload' | 'youtube')
--         plus the YouTube identifiers. Existing rows are all native uploads,
--         so the column defaults to 'upload' and every current read path keeps
--         working untouched (video_url stays populated for both sources).
--
-- PART B  social_videos_archive was created with `LIKE public.social_videos`
--         (migration 020), which is a one-time snapshot — it does NOT track
--         later ALTERs. It needs the same three columns, and
--         rotate_expired_social_videos() needs to carry them across, otherwise
--         a rotated YouTube post loses its identifiers in the archive.
--
-- PART C  archive_social_video(uuid): copy a single live row into the archive.
--         Manual deletes (owner or admin, via DELETE /api/social/videos/[id])
--         call this first so a removal is preserved for audit/restore in the
--         same place the 24h rotation puts expired posts — "archive, don't
--         destroy" stays true for every path out of the live table.
--
-- feed_items is intentionally untouched: its payload column is jsonb, so a
-- YouTube item there carries {"source":"youtube","youtube_id":"..."} in
-- `content` with no schema change. Mirror reads social_videos today.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- PART A — source discriminator + YouTube identifiers on the live table
-- ----------------------------------------------------------------------------

alter table public.social_videos
  add column if not exists source text not null default 'upload',
  add column if not exists youtube_id text,
  add column if not exists youtube_url text;

-- Drop then re-add the CHECKs so re-runs stay idempotent (same pattern as 019).
alter table public.social_videos
  drop constraint if exists social_videos_source_check;
alter table public.social_videos
  add constraint social_videos_source_check
  check (source in ('upload', 'youtube'));

-- A YouTube post is only meaningful with its 11-char video id, and an upload
-- must never carry one. This is the DB-side mirror of the server-side URL
-- validation in src/lib/youtube.ts, so a bad row can't be written even if a
-- future code path forgets to normalize.
alter table public.social_videos
  drop constraint if exists social_videos_youtube_id_check;
alter table public.social_videos
  add constraint social_videos_youtube_id_check
  check (
    (source = 'youtube' and youtube_id ~ '^[A-Za-z0-9_-]{11}$')
    or (source <> 'youtube' and youtube_id is null)
  );

-- The Mirror feed reads by (created_at, id) and never filters on source, so no
-- extra index is needed for the feed. This partial index serves the admin panel
-- and any future "YouTube only" view without costing writes on upload rows.
create index if not exists idx_social_videos_youtube
  on public.social_videos (created_at desc)
  where source = 'youtube';

-- ----------------------------------------------------------------------------
-- PART B — archive table + rotation sweep carry the new columns
-- ----------------------------------------------------------------------------

alter table public.social_videos_archive
  add column if not exists source text not null default 'upload',
  add column if not exists youtube_id text,
  add column if not exists youtube_url text;

-- Archive rows are historical records, not live content: no CHECK constraints
-- here on purpose, so a legacy row can always be filed away.

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
     likes_count, comments_count, created_at, media_type, expires_at,
     source, youtube_id, youtube_url)
  select
    id, user_id, title, description, video_url, thumbnail_url,
    likes_count, comments_count, created_at, media_type, expires_at,
    source, youtube_id, youtube_url
  from expired;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- ----------------------------------------------------------------------------
-- PART C — archive a single post on manual delete
-- ----------------------------------------------------------------------------

-- Copies one live social_videos row into the archive WITHOUT deleting it; the
-- caller (the DELETE route) removes the live row afterwards so the feed reflects
-- the removal even if the caller dies between the two steps. The archive table
-- was built with `LIKE ... INCLUDING DEFAULTS`, which copies no primary key, so
-- de-duplication is an explicit NOT EXISTS rather than ON CONFLICT — that keeps
-- a retry (or a delete of an already-archived id) from filing the row twice.
-- Returns true when a row was filed.
create or replace function public.archive_social_video(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  filed integer;
begin
  insert into public.social_videos_archive
    (id, user_id, title, description, video_url, thumbnail_url,
     likes_count, comments_count, created_at, media_type, expires_at,
     source, youtube_id, youtube_url)
  select
    id, user_id, title, description, video_url, thumbnail_url,
    likes_count, comments_count, created_at, media_type, expires_at,
    source, youtube_id, youtube_url
  from public.social_videos
  where id = p_id
    and not exists (
      select 1 from public.social_videos_archive a where a.id = p_id
    );
  get diagnostics filed = row_count;
  return filed > 0;
end;
$$;

comment on function public.archive_social_video(uuid) is
  'Copies a live social_videos row into social_videos_archive before a manual delete (owner or admin). Idempotent.';

-- Only the service role should file archive rows; the API routes that call this
-- already run behind requireArtist/requireAdmin with the service-role client.
revoke all on function public.archive_social_video(uuid) from public, anon, authenticated;
