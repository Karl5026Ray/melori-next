-- =====================================================================
-- Track listens + superfan aggregation (2026-07-07)
-- =====================================================================
-- Adds a per-listen event log so an artist can see their top listeners
-- ("superfans"). One row per stream fetch by an authenticated listener.
--
-- Design:
--   * Two nullable FK columns (studio_track_id, legacy_track_id) because
--     the codebase has both a legacy `tracks` (int PK) surface and a
--     newer `studio_tracks` (UUID PK) surface. A CHECK enforces exactly
--     one is set per row.
--   * `artist_owner_id` denormalizes the artist's profile_id at insert
--     time so the "top fans per artist" aggregation is a single-table
--     scan with no joins on the hot path.
--   * `listener_id` is the authenticated auth.users.id / profiles.id.
--     Anonymous / free-tier listens are NEVER inserted (see the stream
--     route). This matches the product rule: "superfans are account
--     holders with an active membership tier."
--   * `seconds_played` is present for future partial-listen weighting
--     but the current MVP just counts rows (each stream URL fetch = 1
--     play). Preview/free listens do not reach this table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.track_listens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_track_id UUID REFERENCES public.studio_tracks(id) ON DELETE CASCADE,
    legacy_track_id INTEGER REFERENCES public.tracks(id) ON DELETE CASCADE,
    listener_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    artist_owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    listened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seconds_played INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT track_listens_one_track CHECK (
        (studio_track_id IS NULL) <> (legacy_track_id IS NULL)
    )
);

-- Hot path: "top fans for artist X" — ORDER BY listened_at is not required,
-- we group by listener_id and count. But we also want "recent listens per
-- artist" for the richer Studio view, so cover both.
CREATE INDEX IF NOT EXISTS idx_track_listens_artist_owner_recent
    ON public.track_listens(artist_owner_id, listened_at DESC);

CREATE INDEX IF NOT EXISTS idx_track_listens_artist_listener
    ON public.track_listens(artist_owner_id, listener_id);

CREATE INDEX IF NOT EXISTS idx_track_listens_listener
    ON public.track_listens(listener_id, listened_at DESC);

-- RLS: the service-role client (used by the stream endpoint + aggregation
-- endpoints) bypasses RLS, so these policies exist for defense-in-depth
-- against direct client access with an anon key.
--
-- Read policy: an artist can select their own listen rows only.
-- Insert policy: nobody via anon key — only service role inserts.
ALTER TABLE public.track_listens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "artist can read own listen rows" ON public.track_listens;
CREATE POLICY "artist can read own listen rows"
    ON public.track_listens
    FOR SELECT
    USING (auth.uid() = artist_owner_id);

-- Explicit deny for anon inserts (service role bypasses; no anon insert path
-- is desired since we only log listens server-side after auth checks).
DROP POLICY IF EXISTS "no anon inserts on track_listens" ON public.track_listens;
CREATE POLICY "no anon inserts on track_listens"
    ON public.track_listens
    FOR INSERT
    WITH CHECK (false);

COMMENT ON TABLE public.track_listens IS
    'One row per authenticated (superfan+) stream fetch. Powers the /api/artist/superfans and /api/artists/[slug]/superfans aggregations.';
