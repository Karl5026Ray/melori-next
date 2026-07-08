-- 015_rollback.sql — reverse 015_publish_first_moderation.sql
BEGIN;

-- Restore approval-gated defaults.
ALTER TABLE public.tracks    ALTER COLUMN is_published SET DEFAULT false;
ALTER TABLE public.releases  ALTER COLUMN is_published SET DEFAULT false;
ALTER TABLE public.artists   ALTER COLUMN is_published SET DEFAULT false;

-- Restore original public read policy.
DROP POLICY IF EXISTS "Public read published clean tracks" ON public.tracks;
DROP POLICY IF EXISTS "Owner read own tracks" ON public.tracks;
CREATE POLICY "Public read published tracks"
  ON public.tracks FOR SELECT USING (is_published = true);

DROP TRIGGER IF EXISTS trg_tracks_publish_stamp ON public.tracks;
DROP FUNCTION IF EXISTS public.tracks_publish_stamp();
DROP INDEX IF EXISTS public.idx_tracks_moderation_status;

-- Submission vocabulary back to original.
ALTER TABLE public.track_submissions
  DROP CONSTRAINT IF EXISTS track_submissions_status_check;
ALTER TABLE public.track_submissions
  ADD CONSTRAINT track_submissions_status_check
  CHECK (status IN ('pending','approved','rejected'));

-- The new moderation columns are harmless to keep; drop only if you want a
-- clean revert. Uncomment to remove:
-- ALTER TABLE public.tracks
--   DROP COLUMN IF EXISTS moderation_status,
--   DROP COLUMN IF EXISTS moderation_reason,
--   DROP COLUMN IF EXISTS moderated_by,
--   DROP COLUMN IF EXISTS moderated_at,
--   DROP COLUMN IF EXISTS published_at;

COMMIT;
