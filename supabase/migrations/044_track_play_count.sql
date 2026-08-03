-- 044_track_play_count.sql
--
-- Lifetime play counts for legacy `tracks`.
--
-- NOTE: this migration was ALREADY APPLIED to the production Supabase project
-- ahead of the app change. It is committed here for version-control parity so
-- a fresh environment reproduces the same schema. Written idempotently, so
-- re-running it against production is a no-op.
--
-- Why a SECURITY DEFINER function instead of a plain UPDATE from the client:
-- the browser holds only the anon key, and `tracks` is not writable under RLS
-- (nor should it be — an anon UPDATE grant would let anyone rewrite any
-- column). The function narrows that power to exactly one operation, "+1 on
-- this one row", and re-applies the site's publish gate server-side so an
-- unpublished or moderated-out track can never accumulate plays even if a
-- caller asks for it. Declining returns 0 rather than raising, because the
-- caller is fire-and-forget and must never see playback interrupted.
--
-- `search_path = public` is pinned per the usual SECURITY DEFINER hardening:
-- without it a caller-controlled search_path could resolve `tracks` to a table
-- of their own choosing inside a definer-privileged body.
--
-- Counts are incremented by the client (the shared PlayerProvider, after ~20s
-- of audible playback) and are therefore spammable by a determined caller.
-- Accepted for now: this is a display metric, not a payout input. The upgrade
-- path is a server-side /api/tracks/[id]/play route writing to a `track_plays`
-- events table, which also buys per-listener dedupe and real analytics.

alter table public.tracks
  add column if not exists play_count bigint not null default 0;

comment on column public.tracks.play_count is
  'Lifetime audible plays. Incremented only via public.increment_track_play().';

create or replace function public.increment_track_play(p_track_id integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count bigint;
begin
  update public.tracks
     set play_count = play_count + 1
   where id = p_track_id
     and is_published = true
     and moderation_status = 'clean'
  returning play_count into v_new_count;

  -- No row matched: unknown id, unpublished, or moderated out. Report 0 so the
  -- client leaves whatever total it is already showing alone.
  return coalesce(v_new_count, 0);
end;
$$;

grant execute on function public.increment_track_play(integer) to anon;
grant execute on function public.increment_track_play(integer) to authenticated;
