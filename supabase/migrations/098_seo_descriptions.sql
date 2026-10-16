-- 098: search-engine descriptions for public artist and album pages.
--
-- Written server-side by /api/cron/seo-descriptions (Claude API, Karl's Max
-- plan monthly credit), read by each page's generateMetadata. A SEPARATE
-- column, not bio/description: those are the artist's own words, shown on the
-- page. This text is only the <meta name="description"> a search result shows,
-- generated from facts already on the page.
--
-- seo_generated_at lets the job skip rows that already have one and refresh
-- rows edited since (updated_at > seo_generated_at). No new policies: these
-- tables' existing SELECT policies already expose the rows the pages read, and
-- writes come only from the service role.

alter table public.artists
  add column if not exists seo_description text,
  add column if not exists seo_generated_at timestamptz;

alter table public.releases
  add column if not exists seo_description text,
  add column if not exists seo_generated_at timestamptz;

alter table public.studio_albums
  add column if not exists seo_description text,
  add column if not exists seo_generated_at timestamptz;

comment on column public.artists.seo_description is
  'Search-result description (<=160 chars), AI-generated from page facts. Service role writes.';
comment on column public.releases.seo_description is
  'Search-result description (<=160 chars), AI-generated from page facts. Service role writes.';
comment on column public.studio_albums.seo_description is
  'Search-result description (<=160 chars), AI-generated from page facts. Service role writes.';
