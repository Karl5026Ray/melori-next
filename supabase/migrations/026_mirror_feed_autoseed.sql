-- 026_mirror_feed_autoseed.sql
-- =============================================================================
-- Melori Mirror: keep the "24/7" For-You feed populated automatically.
--
-- The 24h rotation (migration 020) sweeps social_videos rows out after 24h, but
-- nothing was ever putting content IN, so the feed sat empty. This adds an
-- auto-seeder that tops the live feed up from the existing published-track
-- catalog (as audio posts) and an hourly pg_cron job that runs it, so the
-- Mirror always has fresh items around the clock.
--
-- Content source: published tracks that have a playable URL and belong to an
-- artist with a linked profile (so social_videos.user_id is a real user).
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.seed_mirror_feed(target_count int default 12)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  live_count int;
  need int;
  inserted int := 0;
begin
  -- How many unexpired items are live right now?
  select count(*) into live_count
  from public.social_videos
  where expires_at > now();

  need := target_count - live_count;
  if need <= 0 then
    return 0;
  end if;

  -- Pull `need` random usable tracks that aren't already live in the feed
  -- (dedupe by video_url), and insert them as audio posts. The BEFORE INSERT
  -- expiry trigger (migration 020) sets expires_at = now() + 24h automatically.
  with pool as (
    select
      a.profile_id                                  as user_id,
      t.title                                       as title,
      coalesce(nullif(t.preview_url, ''), t.audio_url) as media_url,
      r.cover_art_url                               as thumb,
      a.name                                        as artist_name
    from public.tracks t
    join public.releases r on r.id = t.release_id
    join public.artists  a on a.id = r.artist_id
    where t.is_published
      and a.profile_id is not null
      and coalesce(nullif(t.preview_url, ''), t.audio_url) is not null
  ),
  fresh as (
    select * from pool p
    where not exists (
      select 1 from public.social_videos sv
      where sv.expires_at > now()
        and sv.video_url = p.media_url
    )
    order by random()
    limit need
  ),
  ins as (
    insert into public.social_videos
      (user_id, title, description, video_url, thumbnail_url, media_type)
    select
      user_id,
      title,
      case when artist_name is not null then 'by ' || artist_name else null end,
      media_url,
      thumb,
      'audio'
    from fresh
    returning 1
  )
  select count(*) into inserted from ins;

  return inserted;
end;
$$;

comment on function public.seed_mirror_feed(int) is
  'Tops the live Melori Mirror feed up to target_count by inserting fresh audio posts from the published-track catalog. Called hourly by cron job mirror-feed-autoseed.';

-- Seed immediately so the feed is populated right now.
select public.seed_mirror_feed(12);

-- Hourly top-up so the feed never empties (24/7). Uses pg_cron (already
-- installed). Unschedule any prior copy first to stay idempotent.
do $$
begin
  perform cron.unschedule('mirror-feed-autoseed')
  where exists (select 1 from cron.job where jobname = 'mirror-feed-autoseed');
end $$;

select cron.schedule(
  'mirror-feed-autoseed',
  '0 * * * *',                     -- top of every hour
  $$select public.seed_mirror_feed(12);$$
);
