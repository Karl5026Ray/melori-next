-- 101: Member posts on Melori Mirror stay up for at least 3 weeks (was 7 days).
-- Applied to production 2026-10-22 as migration `101_mirror_member_posts_3_weeks`.
-- Seeded filler sets its own expires_at (18-30h stagger) and is unaffected by the trigger.

create or replace function public.set_feed_expiry()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.expires_at is null then
    new.expires_at := coalesce(new.created_at, now()) + interval '21 days';
  end if;
  return new;
end;
$function$;

-- Extend live member posts that were stamped with the old 7-day window.
update public.social_videos
   set expires_at = created_at + interval '21 days'
 where expires_at > now()
   and expires_at <= created_at + interval '7 days 1 minute'
   and expires_at >= created_at + interval '6 days 23 hours';

update public.feed_items
   set expires_at = created_at + interval '21 days'
 where expires_at > now()
   and expires_at <= created_at + interval '7 days 1 minute'
   and expires_at >= created_at + interval '6 days 23 hours';

-- "Impossibly by Kael R" (giZ_SLys2HM) was removed from YouTube and showed
-- "Video unavailable" in the Mirror. Retire it from the filler pool.
update public.videos set is_active = false where youtube_id = 'giZ_SLys2HM';
update public.social_videos set expires_at = now() where youtube_id = 'giZ_SLys2HM' and expires_at > now();
