-- 074: guarantee REFLECT / Without The Blacks slots in the Mirror top-up.
--
-- Applied to production 2026-09-05. Recorded here after the fact -- the repo
-- had drifted from the live ledger again (see tasks/lessons.md).
--
-- WHY
-- 070 built the filler pool from published tracks (audio) plus the permanent
-- Videos page (YouTube), then interleaved them with
--   row_number() over (partition by media_type order by random())
-- That is a fair 50/50 audio-vs-video split on a large top-up, but on the
-- common case -- seed_mirror_feed() replacing ONE expired item -- it is a coin
-- flip, and losing the flip means no WTB episode enters the feed at all. With
-- a mostly-full feed (need = 0) nothing is seeded either, which is why the
-- episodes were effectively absent from Mirror.
--
-- FIX
-- Reserve a floor of REFLECT episodes BEFORE the interleave runs:
--   reflect_floor := greatest(1, ceil(need / 3))
-- so a single-slot top-up always takes a REFLECT episode, and a larger one
-- takes roughly a third. The remainder still uses the 070 interleave.
--
-- Verified with a dry run inside begin/rollback at need = 1: returned
-- "Without The Blacks EP 11 - Dorothy Vaughan", not a coin flip.

create or replace function public.seed_mirror_feed(target_count integer default 12)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  live_count int;
  need int;
  inserted int := 0;
  reflect_floor int;
  fallback_owner uuid := 'ad930dea-5192-48ed-b4ae-cfeefd43e01f';
begin
  select count(*) into live_count
    from public.social_videos
   where expires_at > now();

  need := target_count - live_count;
  if need <= 0 then return 0; end if;

  reflect_floor := greatest(1, ceil(need::numeric / 3)::int);

  with pool as (
    select a.profile_id                                            as user_id,
           t.title                                                 as title,
           case when a.name is not null then 'by ' || a.name end    as descr,
           coalesce(nullif(t.preview_url, ''), t.audio_url)         as media_url,
           r.cover_art_url                                         as thumb,
           'audio'::text                                           as media_type,
           'upload'::text                                          as src,
           null::text                                              as yt_id,
           false                                                   as is_reflect
      from public.tracks t
      join public.releases r on r.id = t.release_id
      join public.artists  a on a.id = r.artist_id
     where t.is_published
       and a.profile_id is not null
       and coalesce(nullif(t.preview_url, ''), t.audio_url) is not null

    union all

    select coalesce(a.profile_id, fallback_owner)                  as user_id,
           v.title,
           v.description                                           as descr,
           'https://www.youtube.com/watch?v=' || v.youtube_id       as media_url,
           coalesce(v.thumbnail_url,
                    'https://i.ytimg.com/vi/' || v.youtube_id || '/hqdefault.jpg') as thumb,
           'video'::text                                           as media_type,
           'youtube'::text                                         as src,
           v.youtube_id                                            as yt_id,
           (v.series = 'REFLECT')                                  as is_reflect
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
  reflect_pick as (
    select * from avail where is_reflect order by random() limit reflect_floor
  ),
  rest as (
    select *, row_number() over (partition by media_type order by random()) as rn_in_type
      from avail a
     where not exists (select 1 from reflect_pick rp where rp.media_url = a.media_url)
  ),
  rest_pick as (
    select user_id, title, descr, media_url, thumb, media_type, src, yt_id, is_reflect
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
       source, youtube_id, youtube_url, expires_at)
    select user_id, title, descr, media_url, thumb, media_type, src, yt_id,
           case when src = 'youtube' then media_url end,
           now() + interval '18 hours' + (random() * interval '12 hours')
      from fresh
    returning 1
  )
  select count(*) into inserted from ins;

  return inserted;
end;
$function$;
