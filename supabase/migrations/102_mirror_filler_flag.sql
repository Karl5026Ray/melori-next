-- 102: The hourly autoseeder counts only its own filler.
-- Applied to production 2026-10-22 as migration `102_mirror_filler_flag`.
-- With member posts living 21 days (migration 101), counting every live row would let
-- member posts fill the 12 slots and stop the REFLECT/music rotation.

alter table public.social_videos add column if not exists is_filler boolean not null default false;

-- Mark currently-live seeded filler (the seeder gives 18-30h lifetimes).
update public.social_videos
   set is_filler = true
 where expires_at > now()
   and expires_at < created_at + interval '31 hours';

CREATE OR REPLACE FUNCTION public.seed_mirror_feed(target_count integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  live_count int;
  need int;
  inserted int := 0;
  reflect_floor int;
  -- Owner for platform videos with no artist attached (karlray, admin).
  fallback_owner uuid := 'ad930dea-5192-48ed-b4ae-cfeefd43e01f';
begin
  select count(*) into live_count
    from public.social_videos
   where expires_at > now()
     and is_filler;

  need := target_count - live_count;
  if need <= 0 then return 0; end if;

  -- At least one REFLECT episode per run, and roughly a third of a larger
  -- top-up. greatest(1, ...) is what removes the coin flip on need = 1.
  reflect_floor := greatest(1, ceil(need::numeric / 3)::int);

  with pool as (
    -- A. Music: track previews, credited to the artist who owns them.
    select a.profile_id                                            as user_id,
           t.title                                                 as title,
           case when a.name is not null then 'by ' || a.name end    as descr,
           coalesce(nullif(t.preview_url, ''), t.audio_url)         as media_url,
           r.cover_art_url                                         as thumb,
           'audio'::text                                           as media_type,
           'upload'::text                                          as src,
           null::text                                              as yt_id,
           false                                                   as is_reflect,
           null::boolean                                           as is_vert
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
           v.youtube_id                                            as yt_id,
           (v.series = 'REFLECT')                                  as is_reflect,
           v.is_vertical                                           as is_vert
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
  -- 1. Reserve the REFLECT floor first.
  reflect_pick as (
    select * from avail where is_reflect order by random() limit reflect_floor
  ),
  -- 2. Fill whatever is left with the balanced audio/video interleave.
  rest as (
    select *, row_number() over (partition by media_type order by random()) as rn_in_type
      from avail a
     where not exists (select 1 from reflect_pick rp where rp.media_url = a.media_url)
  ),
  rest_pick as (
    select user_id, title, descr, media_url, thumb, media_type, src, yt_id,
           is_reflect, is_vert
      from rest
     order by rn_in_type, random()
     limit greatest(0, need - (select count(*) from reflect_pick))
  ),
  fresh as (
    select * from reflect_pick
    union all
    select * from rest_pick
  ),
  ins as (
    insert into public.social_videos
      (user_id, title, description, video_url, thumbnail_url, media_type,
       source, youtube_id, youtube_url, is_vertical, expires_at, is_filler)
    select user_id,
           title,
           descr,
           media_url,
           thumb,
           media_type,
           src,
           yt_id,
           case when src = 'youtube' then media_url end,
           is_vert,
           -- Staggered: every filler item gets its own 18-30h life, so the
           -- feed turns over continuously instead of flipping all at once.
           now() + interval '18 hours' + (random() * interval '12 hours'),
           true
      from fresh
    returning 1
  )
  select count(*) into inserted from ins;

  return inserted;
end;
$function$;
