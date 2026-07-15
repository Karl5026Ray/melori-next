-- 026_mirror_feed_autoseed.sql
-- =============================================================================
-- Melori Mirror: keep the "24/7" For-You feed populated automatically.
--
-- The 24h rotation (migration 020) sweeps social_videos rows out after 24h, but
-- nothing was ever putting content IN, so the feed sat empty. This adds an
-- auto-seeder that tops the live feed up from existing content and an hourly
-- pg_cron job that runs it, so the Mirror always has fresh items around the
-- clock.
--
-- Content sources (mixed media, round-robined so scarce video isn't drowned
-- out by the much larger audio catalog):
--   * AUDIO — published tracks with a playable URL, belonging to an artist with
--     a linked profile (so social_videos.user_id is a real user).
--   * VIDEO — intro clips on dating_profiles (public social-videos bucket),
--     with the profile photo as the thumbnail.
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

  with pool as (
    -- AUDIO: published tracks
    select
      a.profile_id                                     as user_id,
      t.title                                          as title,
      coalesce(nullif(t.preview_url, ''), t.audio_url) as media_url,
      r.cover_art_url                                  as thumb,
      a.name                                           as artist_name,
      'audio'::text                                    as media_type
    from public.tracks t
    join public.releases r on r.id = t.release_id
    join public.artists  a on a.id = r.artist_id
    where t.is_published
      and a.profile_id is not null
      and coalesce(nullif(t.preview_url, ''), t.audio_url) is not null
    union all
    -- VIDEO: dating-profile intro clips
    select
      dp.user_id                                       as user_id,
      coalesce(p.display_name, 'Intro') || ' — intro'  as title,
      dp.videos[1]                                     as media_url,
      (dp.photos)[1]                                   as thumb,
      p.display_name                                   as artist_name,
      'video'::text                                    as media_type
    from public.dating_profiles dp
    left join public.profiles p on p.id = dp.user_id
    where array_length(dp.videos, 1) > 0
      and dp.videos[1] is not null
  ),
  -- Only items not already live (dedupe by url).
  avail as (
    select * from pool p
    where not exists (
      select 1 from public.social_videos sv
      where sv.expires_at > now()
        and sv.video_url = p.media_url
    )
  ),
  -- Rank within each media type so we can round-robin across types. This gives
  -- scarce video content a fair share instead of being drowned out by the much
  -- larger audio pool under a flat random() pick.
  ranked as (
    select *,
           row_number() over (partition by media_type order by random()) as rn_in_type
    from avail
  ),
  fresh as (
    select user_id, title, media_url, thumb, artist_name, media_type
    from ranked
    order by rn_in_type, random()   -- interleave: 1st of each type, then 2nd, ...
    limit need
  ),
  ins as (
    insert into public.social_videos
      (user_id, title, description, video_url, thumbnail_url, media_type)
    select
      user_id,
      title,
      case
        when media_type = 'audio' and artist_name is not null then 'by ' || artist_name
        else null
      end,
      media_url,
      thumb,
      media_type
    from fresh
    returning 1
  )
  select count(*) into inserted from ins;

  return inserted;
end;
$$;

comment on function public.seed_mirror_feed(int) is
  'Tops the live Melori Mirror feed up to target_count by inserting fresh posts (audio tracks + profile intro videos, round-robined). Called hourly by cron job mirror-feed-autoseed.';

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
