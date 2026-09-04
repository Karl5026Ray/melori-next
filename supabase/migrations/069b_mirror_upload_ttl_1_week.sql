-- 069b_mirror_upload_ttl_1_week.sql
-- =============================================================================
-- RECORD OF AN OUT-OF-REPO CHANGE.
--
-- This exact SQL was applied directly to the production database on
-- 2026-08-23 as migration version 20260823102011 ("mirror_upload_ttl_1_week")
-- and was never committed here. It is checked in now so the repo and the
-- database agree, and so that a future `supabase db reset` does not silently
-- revert Mirror to the 24-hour TTL from migration 020.
--
-- Effect: member posts (uploads and YouTube links) live for 7 days instead of
-- 24 hours. Auto-seeded filler is NOT covered by this trigger any more --
-- migration 070 gives filler its own staggered 18-30h expiry at insert time,
-- which is what keeps the feed rotating.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.set_feed_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at is null then
    new.expires_at := coalesce(new.created_at, now()) + interval '7 days';
  end if;
  return new;
end;
$$;
