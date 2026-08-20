-- 056_social_video_like_comment_counters.sql
--
-- NOTE: this file was renumbered from 021_social_video_like_comment_counters.sql.
-- It was already applied to production BEFORE the renumbering, under the
-- recorded migration name "social_video_like_comment_counters" (version
-- 20260714185812) -- see issue #295. Renaming the file does not re-run it:
-- Supabase's migration ledger keys on the recorded version string, not the
-- filename, so this rename is safe and is a no-op against the already-applied
-- database. This file is kept (rather than deleted) so a fresh database
-- built from this repo still gets the triggers and backfill below.
--
-- The number 021 was used by two files at once (this one, applied first at
-- 2026-07-14 18:58 UTC, and 021_follows.sql, applied second at 20:37 UTC and
-- keeping the 021 name in the ledger). This file was moved to the next free
-- number, 056, per issue #295. See scripts/migration-prefix.test.ts for the
-- guard test that now prevents a third collision.
--
-- =============================================================================
-- Keep social_videos.likes_count / comments_count in sync with the
-- social_video_likes / social_video_comments tables via triggers, so the
-- denormalized counts shown in VideoCard are always accurate regardless of
-- which code path inserts/deletes a like or comment.
--
-- The like/comment tables already exist (id, video_id, user_id, ...), with a
-- UNIQUE (video_id, user_id) on likes for idempotent toggling. This migration
-- only adds the counter-maintenance triggers and a one-time backfill.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---- likes counter -----------------------------------------------------------
create or replace function public.sync_social_video_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.social_videos
      set likes_count = coalesce(likes_count, 0) + 1
      where id = new.video_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.social_videos
      set likes_count = greatest(coalesce(likes_count, 0) - 1, 0)
      where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_social_video_likes_count on public.social_video_likes;
create trigger trg_social_video_likes_count
  after insert or delete on public.social_video_likes
  for each row execute function public.sync_social_video_likes_count();

-- ---- comments counter --------------------------------------------------------
create or replace function public.sync_social_video_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.social_videos
      set comments_count = coalesce(comments_count, 0) + 1
      where id = new.video_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.social_videos
      set comments_count = greatest(coalesce(comments_count, 0) - 1, 0)
      where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_social_video_comments_count on public.social_video_comments;
create trigger trg_social_video_comments_count
  after insert or delete on public.social_video_comments
  for each row execute function public.sync_social_video_comments_count();

-- ---- one-time backfill so existing rows are correct --------------------------
update public.social_videos v
  set likes_count = coalesce(l.cnt, 0)
  from (
    select video_id, count(*) as cnt
    from public.social_video_likes group by video_id
  ) l
  where l.video_id = v.id;

update public.social_videos v
  set likes_count = 0
  where not exists (
    select 1 from public.social_video_likes l where l.video_id = v.id
  );

update public.social_videos v
  set comments_count = coalesce(c.cnt, 0)
  from (
    select video_id, count(*) as cnt
    from public.social_video_comments group by video_id
  ) c
  where c.video_id = v.id;

update public.social_videos v
  set comments_count = 0
  where not exists (
    select 1 from public.social_video_comments c where c.video_id = v.id
  );
