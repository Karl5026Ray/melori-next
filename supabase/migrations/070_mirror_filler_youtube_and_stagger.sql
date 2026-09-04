-- 070_mirror_filler_youtube_and_stagger.sql
-- =============================================================================
-- Melori Mirror filler: what rotates, and how often.
--
-- WHY: migration 020 designed Mirror as a 24-hour rotation. The out-of-repo
-- migration 20260823102011_mirror_upload_ttl_1_week moved set_feed_expiry() to
-- 7 days for EVERY row, including the hourly auto-seeded filler. Because
-- seed_mirror_feed() only tops the feed back up to 12, the whole cohort now
-- expires together and the feed sits frozen for ~6 days out of 7.
--
-- THIS MIGRATION:
--   1. Filler pool = published music tracks + every YouTube video on the
--      permanent Videos page (public.videos) -- music videos and the
--      REFLECT / Without The Blacks episodes. YouTube rows are posted as
--      links (source='youtube'), never as uploads.
--   2. The dating-profile intro clips are dropped from the pool.
--   3. Seeded filler now carries its own staggered 18-30h expiry, so a few
--      items roll over every hour and cohorts never re-synchronise. Real
--      member posts are untouched and keep the 7-day TTL from
--      set_feed_expiry() (the trigger only fires when expires_at is null).
--   4. One-off cleanup: archive and remove the intro clips that are live now.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.seed_mirror_feed(target_count integer default 12)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  live_count int;
  need int;
  inserted int := 0;
  -- Owner for platform videos with no artist attached (karlray, admin).
  fallback_owner uuid := 'ad930dea-5192-48ed-b4ae-cfeefd43e01f';
begin
  select count(*) into live_count
    from public.social_videos
   where expires_at > now();

  need := target_count - live_count;
  if need <= 0 then return 0; end if;

  with pool as (
    -- A. Music: track previews, credited to the artist who owns them.
    select a.profile_id                                            as user_id,
           t.title                                                 as title,
           case when a.name is not null then 'by ' || a.name end    as descr,
           coalesce(nullif(t.preview_url, ''), t.audio_url)         as media_url,
           r.cover_art_url                                         as thumb,
           'audio'::text                                           as media_type,
           'upload'::text                                          as src,
           null::text                                              as yt_id
      from public.tracks t
      join public.releases r on r.id = t.release_id
      join public.artists  a on a.id = r.artist_id
     where t.is_published
       and a.profile_id is not null
       and coalesce(nullif(t.preview_url, ''), t.audio_url) is not null

    union all

    -- B. YouTube: the permanent Videos page -- music videos and REFLECT / WTB
    --    episodes. Posted as YouTube links, not uploads.
    select coalesce(a.profile_id, fallback_owner)                  as user_id,
           v.title,
           v.description                                           as descr,
           'https://www.youtube.com/watch?v=' || v.youtube_id       as media_url,
           coalesce(v.thumbnail_url,
                    'https://i.ytimg.com/vi/' || v.youtube_id || '/hqdefault.jpg') as thumb,
           'video'::text                                           as media_type,
           'youtube'::text                                         as src,
           v.youtube_id                                            as yt_id
      from public.videos v
      left join public.artists a on a.id = v.artist_id
     where v.is_active
       and v.youtube_id ~ '^[A-Za-z0-9_-]{11}$'
  ),
  avail as (
    select * from pool p
     where not exists (
       select 1
         from public.social_videos sv
        where sv.expires_at > now()
          and ( sv.video_url = p.media_url
                or (p.yt_id is not null and sv.youtube_id = p.yt_id) )
     )
  ),
  ranked as (
    select *, row_number() over (partition by media_type order by random()) as rn_in_type
      from avail
  ),
  fresh as (
    select * from ranked order by rn_in_type, random() limit need
  ),
  ins as (
    insert into public.social_videos
      (user_id, title, description, video_url, thumbnail_url, media_type,
       source, youtube_id, youtube_url, expires_at)
    select user_id,
           title,
           descr,
           media_url,
           thumb,
           media_type,
           src,
           yt_id,
           case when src = 'youtube' then media_url end,
           -- Staggered: every filler item gets its own 18-30h life, so the
           -- feed turns over continuously instead of flipping all at once.
           now() + interval '18 hours' + (random() * interval '12 hours')
      from fresh
    returning 1
  )
  select count(*) into inserted from ins;

  return inserted;
end;
$$;

comment on function public.seed_mirror_feed(integer) is
  'Tops the Mirror feed up to target_count from published music tracks and the YouTube videos on the permanent Videos page. Filler gets a staggered 18-30h TTL; member posts keep the 7-day TTL.';

-- ---------------------------------------------------------------------------
-- One-off: retire the dating-profile intro clips currently in the feed.
-- Archived first, per "archive, don't destroy".
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select sv.id
      from public.social_videos sv
      join public.dating_profiles dp on dp.user_id = sv.user_id
     where sv.source = 'upload'
       and sv.media_type = 'video'
       and sv.title like '%intro%'
  loop
    perform public.archive_social_video(r.id);
    delete from public.social_videos where id = r.id;
  end loop;
end $$;
