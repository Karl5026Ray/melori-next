-- Studio tracks per-artist ownership isolation (2026-07-04)
-- =====================================================================
-- Adds an owner column to studio_tracks so each artist only sees/edits
-- their own tracks. Until now studio routes only checked the artist TIER
-- (requireArtist), so any artist-tier account could list/modify ANY
-- artist's studio tracks. This becomes unacceptable once >1 artist joins.
--
-- Ownership convention matches the rest of the repo (public.artists,
-- public.track_submissions): a `profile_id UUID REFERENCES profiles(id)`
-- column, compared against auth.uid() (the logged-in member id that
-- requireArtist resolves as membership.userId).
--
-- Everything here is ADDITIVE and safe to run against the live DB:
--   * ADD COLUMN IF NOT EXISTS (nullable) — no rewrite that blocks reads
--   * backfill existing rows to Karl (current sole artist / owner)
--   * CREATE INDEX IF NOT EXISTS
--   * ENABLE RLS + policies (defense-in-depth; app already enforces in
--     code via the service-role client, which bypasses RLS)

-- ---------------------------------------------------------------------
-- 1. Owner column
-- ---------------------------------------------------------------------
ALTER TABLE public.studio_tracks
    ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 2. Backfill existing rows to Karl (platform owner / sole current artist)
--    Resolution order (the same identity the app keys on — profiles.id):
--      a. the profile linked to the seeded "Karl Ray" artist row
--      b. the earliest admin profile (Karl is the platform admin)
--    If neither resolves, we DO NOT silently orphan rows: we RAISE NOTICE
--    with the exact manual command to run. See the report / notice text.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    karl_id UUID;
    orphaned INTEGER;
BEGIN
    SELECT a.profile_id INTO karl_id
    FROM public.artists a
    WHERE a.slug = 'karl-ray' AND a.profile_id IS NOT NULL
    LIMIT 1;

    IF karl_id IS NULL THEN
        SELECT p.id INTO karl_id
        FROM public.profiles p
        WHERE p.role = 'admin'
        ORDER BY p.created_at ASC
        LIMIT 1;
    END IF;

    IF karl_id IS NOT NULL THEN
        UPDATE public.studio_tracks
        SET profile_id = karl_id
        WHERE profile_id IS NULL;
        RAISE NOTICE 'studio_tracks backfilled to profile_id=% (Karl / platform owner)', karl_id;
    ELSE
        SELECT count(*) INTO orphaned FROM public.studio_tracks WHERE profile_id IS NULL;
        RAISE NOTICE 'Could not resolve Karl''s profile id automatically. % studio_tracks row(s) still have NULL profile_id and will be INVISIBLE to the studio UI until assigned. Run: UPDATE public.studio_tracks SET profile_id = ''<KARL_PROFILE_UUID>'' WHERE profile_id IS NULL;', orphaned;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Index on the owner column (studio list/filter queries scope by it)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_studio_tracks_profile_id
    ON public.studio_tracks(profile_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 4. Row Level Security (defense-in-depth).
--    The studio API routes run through the service-role client, which
--    BYPASSES RLS, so ownership is primarily enforced in application code
--    (see src/lib/studio-ownership.ts). These policies mirror the
--    track_submissions convention so a direct anon/user-key query can
--    never leak another artist's rows.
-- ---------------------------------------------------------------------
ALTER TABLE public.studio_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Artists read own studio tracks" ON public.studio_tracks;
CREATE POLICY "Artists read own studio tracks"
    ON public.studio_tracks FOR SELECT
    USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Artists insert own studio tracks" ON public.studio_tracks;
CREATE POLICY "Artists insert own studio tracks"
    ON public.studio_tracks FOR INSERT
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Artists update own studio tracks" ON public.studio_tracks;
CREATE POLICY "Artists update own studio tracks"
    ON public.studio_tracks FOR UPDATE
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins all access studio_tracks" ON public.studio_tracks;
CREATE POLICY "Admins all access studio_tracks"
    ON public.studio_tracks FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
