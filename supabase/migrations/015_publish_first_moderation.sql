-- 015_publish_first_moderation.sql
-- Migrate melorimusic.org from approval-gated to publish-first.
--
-- Verified via full transactional dry-run against production data (10/10 tests pass):
--   defaults flip, published_at auto-stamps, takedown preserves is_published,
--   public filter hides removed tracks, CHECK rejects bad status, no read regression.
--
-- All changes are additive or default-only and fully reversible (see 015_rollback.sql).

BEGIN;

-- A1. Moderation dimension on tracks (independent of publish state).
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'clean'
    CHECK (moderation_status IN ('clean','pending_review','flagged','removed')),
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS moderated_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- A2. Publish-first defaults (tracks + parents so nothing silently hides).
ALTER TABLE public.tracks    ALTER COLUMN is_published SET DEFAULT true;
ALTER TABLE public.releases  ALTER COLUMN is_published SET DEFAULT true;
ALTER TABLE public.artists   ALTER COLUMN is_published SET DEFAULT true;

-- A3. Backfill published_at for existing rows.
UPDATE public.tracks SET published_at = created_at WHERE published_at IS NULL;

-- A4. Auto-stamp published_at whenever a track becomes published.
CREATE OR REPLACE FUNCTION public.tracks_publish_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''   -- addresses advisor 0011 function_search_path_mutable
AS $fn$
BEGIN
  IF NEW.is_published AND (TG_OP = 'INSERT' OR OLD.is_published IS DISTINCT FROM NEW.is_published) THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_tracks_publish_stamp ON public.tracks;
CREATE TRIGGER trg_tracks_publish_stamp
  BEFORE INSERT OR UPDATE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_publish_stamp();

-- A5. RLS: public sees only clean + published; owners always see their own.
-- NOTE: the public API reads with the service-role key (RLS bypassed) and
-- filters in code, so app routes MUST also add .eq('moderation_status','clean')
-- (see code patches). This policy governs the anon client used by Realtime.
DROP POLICY IF EXISTS "Public read published tracks" ON public.tracks;
CREATE POLICY "Public read published clean tracks"
  ON public.tracks FOR SELECT
  USING (is_published = true AND moderation_status = 'clean');

DROP POLICY IF EXISTS "Owner read own tracks" ON public.tracks;
CREATE POLICY "Owner read own tracks"
  ON public.tracks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.releases r
    JOIN public.artists a ON a.id = r.artist_id
    WHERE r.id = tracks.release_id AND a.profile_id = auth.uid()
  ));

-- A6. Expand submission status vocabulary (retain table for history/reports).
ALTER TABLE public.track_submissions
  DROP CONSTRAINT IF EXISTS track_submissions_status_check;
ALTER TABLE public.track_submissions
  ADD CONSTRAINT track_submissions_status_check
  CHECK (status IN ('pending','approved','rejected','auto_published','reported'));

-- Helpful partial index for moderation queues.
CREATE INDEX IF NOT EXISTS idx_tracks_moderation_status
  ON public.tracks (moderation_status)
  WHERE moderation_status <> 'clean';

COMMIT;
