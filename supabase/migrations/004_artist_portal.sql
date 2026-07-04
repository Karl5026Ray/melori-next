-- Artist portal (P2 site-evaluation fixes, 2026-07-04)
-- =====================================================================
-- Two things this migration adds:
--   1. artists.profile_id  — links an artist row to a Supabase user so
--      that user can see "their" dashboard at /dashboard.
--   2. track_submissions   — artist-submitted tracks pending admin
--      approval. Admin approves → we insert into public.tracks.
--
-- Both are additive; nothing existing is touched.

-- ---------------------------------------------------------------------
-- 1. Link Supabase profile → artist row
-- ---------------------------------------------------------------------
ALTER TABLE public.artists
    ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_artists_profile_id ON public.artists(profile_id);

-- ---------------------------------------------------------------------
-- 2. track_submissions — artist upload queue
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.track_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id       INTEGER REFERENCES public.artists(id) ON DELETE SET NULL,
    profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    release_type    TEXT NOT NULL DEFAULT 'single' CHECK (release_type IN ('single','ep','album')),
    genre           TEXT,
    description     TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
    audio_url       TEXT NOT NULL,                 -- signed R2 / Supabase storage path
    cover_url       TEXT,                          -- optional artwork
    file_size_bytes BIGINT,
    duration_sec    INTEGER,
    status          TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
    reviewer_notes  TEXT,
    reviewed_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    approved_track_id INTEGER REFERENCES public.tracks(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_track_submissions_profile ON public.track_submissions(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_submissions_status  ON public.track_submissions(status, created_at DESC);

ALTER TABLE public.track_submissions ENABLE ROW LEVEL SECURITY;

-- Owner (submitting profile) can SELECT/INSERT their own submissions.
DROP POLICY IF EXISTS "Artists read own submissions" ON public.track_submissions;
CREATE POLICY "Artists read own submissions"
    ON public.track_submissions FOR SELECT
    USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Artists insert own submissions" ON public.track_submissions;
CREATE POLICY "Artists insert own submissions"
    ON public.track_submissions FOR INSERT
    WITH CHECK (profile_id = auth.uid());

-- Admins can do everything.
DROP POLICY IF EXISTS "Admins all access track_submissions" ON public.track_submissions;
CREATE POLICY "Admins all access track_submissions"
    ON public.track_submissions FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Auto-touch updated_at on any change.
CREATE OR REPLACE FUNCTION public.touch_track_submissions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_track_submissions_updated_at ON public.track_submissions;
CREATE TRIGGER trg_touch_track_submissions_updated_at
    BEFORE UPDATE ON public.track_submissions
    FOR EACH ROW EXECUTE FUNCTION public.touch_track_submissions_updated_at();
