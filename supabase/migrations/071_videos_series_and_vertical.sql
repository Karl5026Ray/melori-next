-- 071_videos_series_and_vertical.sql
-- =============================================================================
-- The Videos page renders every tile at 16:9. The REFLECT / Without The Blacks
-- episodes are 9:16 vertical shorts, so they need their own shape and their own
-- section rather than sitting letterboxed in the music-video grid.
--
--   series      : optional grouping label, e.g. 'REFLECT'. Null = ungrouped
--                 music video, which is every existing row.
--   is_vertical : render this row in a 9:16 frame instead of 16:9.
--
-- Both are additive with safe defaults, so /video keeps working unchanged until
-- the new page ships.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.videos
  add column if not exists series text,
  add column if not exists is_vertical boolean not null default false;

comment on column public.videos.series is
  'Optional series grouping shown as its own section on /video (e.g. REFLECT). Null for standalone music videos.';
comment on column public.videos.is_vertical is
  'True for 9:16 shorts, which render in a vertical frame and never take the 16:9 featured slot.';

create index if not exists idx_videos_series
  on public.videos (series, sort_order)
  where series is not null;
