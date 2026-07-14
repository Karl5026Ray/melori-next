-- 019_content_moderation.sql
-- Full content-moderation pipeline for user-generated content on melorimusic.org.
--
-- Policy (per owner):
--   * Pornography / nudity  -> QUARANTINE (never public; held for admin, default reject)
--   * Explicit music / borderline sexual imagery -> FLAG for admin review (stays visible)
--   * Everything else clean  -> publishes normally
--
-- Design notes:
--   * Additive only. No existing column/row is dropped. Fully reversible.
--   * Two new tables: content_moderation (quarantine/flag queue) and content_reports
--     (user reports). Both are written ONLY by the service role from API routes, so
--     RLS is enabled with NO anon policies (reads happen via service role in admin API).
--   * User content tables (messages, community_comments, profiles bio, profile_gallery)
--     get a moderation_status column mirroring the tracks vocabulary already in 015.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Shared moderation status vocabulary on user-content tables.
--    Matches tracks.moderation_status from migration 015:
--      'clean' | 'pending_review' | 'flagged' | 'removed'
--    plus 'quarantined' for hard-blocked (porn/nudity) content that must never
--    be public.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages','community_comments','profile_gallery'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format($f$
        ALTER TABLE public.%I
          ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'clean',
          ADD COLUMN IF NOT EXISTS moderation_reason text,
          ADD COLUMN IF NOT EXISTS moderated_at timestamptz
      $f$, t);
      -- Drop then re-add the CHECK so re-runs stay idempotent.
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t||'_moderation_status_check');
      EXECUTE format($f$
        ALTER TABLE public.%I
          ADD CONSTRAINT %I
          CHECK (moderation_status IN ('clean','pending_review','flagged','removed','quarantined'))
      $f$, t, t||'_moderation_status_check');
      -- Partial index for the moderation queue (only non-clean rows).
      EXECUTE format($f$
        CREATE INDEX IF NOT EXISTS %I
          ON public.%I (moderation_status) WHERE moderation_status <> 'clean'
      $f$, 'idx_'||t||'_moderation', t);
    END IF;
  END LOOP;
END $$;

-- profiles bio moderation (single column, no separate status needed — bio is
-- one field; if flagged we blank it and record here).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio_moderation_status text NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS bio_moderation_reason text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_moderation_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_moderation_status_check
  CHECK (bio_moderation_status IN ('clean','pending_review','flagged','removed','quarantined'));

-- ---------------------------------------------------------------------------
-- 2. content_moderation: the quarantine / flag queue.
--    One row per auto-moderation decision that needs (or needed) admin eyes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_moderation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type   text NOT NULL,               -- 'message'|'comment'|'gallery'|'bio'|'avatar'|'banner'|'track'
  content_id     text,                         -- id of the offending row (text: some ids are composite)
  author_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision       text NOT NULL CHECK (decision IN ('quarantined','flagged')),
  reason         text,                         -- human-readable category summary
  categories     jsonb,                        -- raw model category flags/scores
  media_url      text,                         -- for image/video items
  excerpt        text,                         -- for text items (first ~280 chars)
  status         text NOT NULL DEFAULT 'open'  -- 'open'|'approved'|'removed'|'dismissed'
                 CHECK (status IN ('open','approved','removed','dismissed')),
  reviewed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_moderation_open
  ON public.content_moderation (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_content_moderation_decision
  ON public.content_moderation (decision, status);

ALTER TABLE public.content_moderation ENABLE ROW LEVEL SECURITY;
-- No anon policy on purpose: only the service role (admin API) reads/writes this.

-- ---------------------------------------------------------------------------
-- 3. content_reports: user-submitted reports (the human backstop).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type   text NOT NULL,               -- 'message'|'comment'|'gallery'|'profile'|'track'|'other'
  content_id     text,
  reported_user  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reporter_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason         text,                         -- reporter's category choice
  details        text,                         -- free-text note
  status         text NOT NULL DEFAULT 'open'  -- 'open'|'actioned'|'dismissed'
                 CHECK (status IN ('open','actioned','dismissed')),
  reviewed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_reports_open
  ON public.content_reports (created_at DESC) WHERE status = 'open';
-- Prevent a single user spamming duplicate reports on the same item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_reports_reporter_item
  ON public.content_reports (reporter_id, content_type, content_id)
  WHERE reporter_id IS NOT NULL AND content_id IS NOT NULL;

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
-- Users insert reports through the service-role API route (author verified from
-- token there); reads are admin-only via service role. No anon policy.

COMMIT;
