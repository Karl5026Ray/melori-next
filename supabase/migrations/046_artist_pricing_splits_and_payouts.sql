-- 046_artist_pricing_splits_and_payouts.sql
-- =====================================================================
-- Artist self-uploads become first-class, priced catalog items.
--
-- Until now `studio_tracks` (the artist self-upload table) had no price
-- column and no album entity, so artist work could not be sold at all —
-- it rendered in a separate "Latest from Artists" grid with no Buy CTA.
-- Legacy `releases`/`tracks` (admin-curated) carry DECIMAL dollar prices
-- and are the only sellable items. This migration closes that gap and
-- adds an optional collaborator revenue-split model on top.
--
-- APPLIED to production 2026-08-02 as 046_artist_pricing_splits_and_payouts.
-- Everything is additive and idempotent:
--   * ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
--   * guarded ALTER ... ADD CONSTRAINT (pg_constraint probe)
--   * CREATE INDEX IF NOT EXISTS
--   * DROP POLICY IF EXISTS + CREATE POLICY
-- Re-running it is a no-op. It does not drop or rewrite existing data.
--
-- Sections:
--   1. studio_tracks pricing (price_cents, currency)
--   2. studio_albums — stable album entity for artist uploads
--   3. revenue_splits — optional per-item collaborator shares (bps)
--   4. split_payouts — audit trail of every computed split
--   5. music_purchases — defensive create + studio/split columns
--   6. artists backfill — the profile -> artist lookup public pages need

-- ---------------------------------------------------------------------
-- 1. Pricing on artist self-uploads
--
--    Integer cents (never floats — the legacy DECIMAL columns stay as
--    they are; new money is cents everywhere). Default 99 = $0.99, the
--    platform's standard single price. Backfilling existing rows to 99
--    is safe: studio tracks currently have NO purchase path at all, so
--    no existing behaviour depends on them being unpriced.
--
--    Upper bound 99_999_999 ($999,999.99) is Stripe's practical ceiling
--    for a single line item and stops a fat-fingered price from
--    creating an uncheckout-able row. 0 is allowed and means "free" —
--    the UI renders Play/Download instead of Buy.
-- ---------------------------------------------------------------------
ALTER TABLE public.studio_tracks
    ADD COLUMN IF NOT EXISTS price_cents INTEGER,
    ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE public.studio_tracks SET price_cents = 99 WHERE price_cents IS NULL;
UPDATE public.studio_tracks SET currency = 'usd' WHERE currency IS NULL;

ALTER TABLE public.studio_tracks
    ALTER COLUMN price_cents SET DEFAULT 99,
    ALTER COLUMN price_cents SET NOT NULL,
    ALTER COLUMN currency SET DEFAULT 'usd',
    ALTER COLUMN currency SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'studio_tracks_price_cents_range'
    ) THEN
        ALTER TABLE public.studio_tracks
            ADD CONSTRAINT studio_tracks_price_cents_range
            CHECK (price_cents >= 0 AND price_cents <= 99999999);
    END IF;
END $$;

COMMENT ON COLUMN public.studio_tracks.price_cents IS
    'Artist-set single price in integer cents. 0 = free download. Authoritative for checkout — never trust a browser-supplied price.';

-- ---------------------------------------------------------------------
-- 2. studio_albums
--
--    `studio_tracks.album` is free text and is the partition key for
--    per-album `sort_order` (migration 013). We deliberately DO NOT
--    change those semantics — the reorder endpoint still groups by
--    (profile_id, album) text. Instead this is an additive side-car
--    that gives each (owner, album title) pair a stable UUID, a slug,
--    and a price, so an album can be linked to, priced, split, and
--    purchased as one unit.
--
--    Linkage is by (profile_id, title) rather than a FK on studio_tracks
--    so renaming or retitling never orphans tracks mid-flight.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    cover_url TEXT,
    price_cents INTEGER NOT NULL DEFAULT 999,
    currency TEXT NOT NULL DEFAULT 'usd',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT studio_albums_owner_title_unique UNIQUE (profile_id, title),
    CONSTRAINT studio_albums_price_cents_range
        CHECK (price_cents >= 0 AND price_cents <= 99999999)
);

CREATE INDEX IF NOT EXISTS idx_studio_albums_profile_id
    ON public.studio_albums(profile_id, created_at DESC);

-- Backfill one row per distinct (owner, non-empty album title). Slug is
-- derived from the title and de-duplicated with a short id suffix, the
-- same shape src/lib/artist.ts uses for artist slugs.
DO $$
DECLARE
    rec RECORD;
    base_slug TEXT;
    candidate TEXT;
    n INTEGER;
    inserted INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT DISTINCT t.profile_id, btrim(t.album) AS title
        FROM public.studio_tracks t
        WHERE t.profile_id IS NOT NULL
          AND t.album IS NOT NULL
          AND btrim(t.album) <> ''
    LOOP
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.studio_albums a
            WHERE a.profile_id = rec.profile_id AND a.title = rec.title
        );

        base_slug := regexp_replace(lower(rec.title), '[^a-z0-9]+', '-', 'g');
        base_slug := btrim(base_slug, '-');
        IF base_slug = '' THEN base_slug := 'album'; END IF;
        base_slug := left(base_slug, 40);

        candidate := base_slug;
        n := 1;
        WHILE EXISTS (SELECT 1 FROM public.studio_albums a WHERE a.slug = candidate) LOOP
            candidate := base_slug || '-' || left(rec.profile_id::text, 6) ||
                         CASE WHEN n = 1 THEN '' ELSE '-' || n::text END;
            n := n + 1;
        END LOOP;

        INSERT INTO public.studio_albums (profile_id, title, slug)
        VALUES (rec.profile_id, rec.title, candidate);
        inserted := inserted + 1;
    END LOOP;

    RAISE NOTICE 'studio_albums backfill inserted % album row(s)', inserted;
END $$;

-- Give albums a cover from their first track that has one, so the
-- catalog doesn't render a wall of placeholders on day one.
UPDATE public.studio_albums a
SET cover_url = sub.cover_url
FROM (
    SELECT DISTINCT ON (t.profile_id, btrim(t.album))
           t.profile_id, btrim(t.album) AS title, t.cover_url
    FROM public.studio_tracks t
    WHERE t.cover_url IS NOT NULL AND btrim(COALESCE(t.album, '')) <> ''
    ORDER BY t.profile_id, btrim(t.album), t.created_at ASC
) sub
WHERE a.profile_id = sub.profile_id
  AND a.title = sub.title
  AND a.cover_url IS NULL;

-- ---------------------------------------------------------------------
-- 3. revenue_splits
--
--    OPTIONAL collaborator shares on one catalog item. An item with no
--    rows here keeps 100% single-payee behaviour — the existing
--    destination-charge path is untouched.
--
--    Percentages are basis points (1/100th of a percent) so 33.33% is
--    exact and the rows can sum to exactly 10000 with no float drift.
--    The uploading artist's own remainder is NOT stored as a row; it is
--    10000 minus the sum of collaborator rows, which keeps "artist
--    ignores the feature" as the literal empty-table case.
--
--    A payee is identified by a Melori profile_id when they have an
--    account, else by email. At payout time we resolve their Stripe
--    Connect account; if they have none, the share is recorded as owed
--    on the platform account rather than dropped.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Who configured the split; also the artist holding the remainder.
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Exactly one target. Legacy ids are integers, studio ids are UUIDs.
    studio_track_id UUID REFERENCES public.studio_tracks(id) ON DELETE CASCADE,
    studio_album_id UUID REFERENCES public.studio_albums(id) ON DELETE CASCADE,
    release_id INTEGER,
    track_id INTEGER,
    -- Payee
    payee_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    payee_email TEXT,
    payee_name TEXT NOT NULL,
    basis_points INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT revenue_splits_bps_range
        CHECK (basis_points > 0 AND basis_points <= 10000),
    -- Must be attached to exactly one sellable item.
    CONSTRAINT revenue_splits_single_target CHECK (
        (CASE WHEN studio_track_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN studio_album_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN release_id      IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN track_id        IS NOT NULL THEN 1 ELSE 0 END) = 1
    ),
    -- Must be payable to someone.
    CONSTRAINT revenue_splits_payee_present CHECK (
        payee_profile_id IS NOT NULL OR
        (payee_email IS NOT NULL AND btrim(payee_email) <> '')
    )
);

CREATE INDEX IF NOT EXISTS idx_revenue_splits_owner
    ON public.revenue_splits(owner_id);
CREATE INDEX IF NOT EXISTS idx_revenue_splits_studio_track
    ON public.revenue_splits(studio_track_id) WHERE studio_track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_splits_studio_album
    ON public.revenue_splits(studio_album_id) WHERE studio_album_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_splits_release
    ON public.revenue_splits(release_id) WHERE release_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_splits_track
    ON public.revenue_splits(track_id) WHERE track_id IS NOT NULL;

COMMENT ON TABLE public.revenue_splits IS
    'Optional collaborator revenue shares in basis points. No rows for an item = uploading artist keeps 100%.';

-- ---------------------------------------------------------------------
-- 4. split_payouts — audit trail
--
--    One row per payee per sale, written by the Stripe webhook after a
--    split sale settles. `status`:
--      paid   — a Stripe transfer to the payee's Connect account landed
--      owed   — payee has no Connect account; money is sitting on the
--               platform balance and Karl owes it to them
--      failed — the transfer was attempted and Stripe rejected it
--
--    amount_cents across all rows for one purchase must equal the net
--    (post-Stripe-fee) amount. The allocator uses largest-remainder so
--    rounding never creates or destroys a cent.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.split_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id BIGINT,
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,
    stripe_transfer_id TEXT,
    transfer_group TEXT,
    -- Denormalised item identity so the audit row survives item deletion.
    item_kind TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT,
    payee_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    payee_email TEXT,
    payee_name TEXT,
    connected_account_id TEXT,
    basis_points INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'owed',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT split_payouts_status_valid
        CHECK (status IN ('paid', 'owed', 'failed')),
    CONSTRAINT split_payouts_amount_nonneg CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_split_payouts_intent
    ON public.split_payouts(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_split_payouts_payee
    ON public.split_payouts(payee_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_split_payouts_status
    ON public.split_payouts(status, created_at DESC);

-- One audit row per (payment intent, payee) — makes webhook replay a
-- no-op instead of double-paying a collaborator.
CREATE UNIQUE INDEX IF NOT EXISTS uq_split_payouts_intent_payee
    ON public.split_payouts(
        stripe_payment_intent_id,
        COALESCE(payee_profile_id::text, ''),
        COALESCE(payee_email, '')
    )
    WHERE stripe_payment_intent_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. music_purchases
--
--    This table is written by src/app/api/stripe/webhook/route.ts and
--    read by /api/music/download, but it has no migration in this repo
--    (it was created by hand in the Supabase console). Created here
--    defensively so a fresh environment reproduces it, then extended
--    with the studio/split columns. On production the CREATE is a
--    no-op and only the ADD COLUMNs apply.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.music_purchases (
    id BIGSERIAL PRIMARY KEY,
    buyer_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    buyer_email TEXT,
    release_id INTEGER,
    track_id INTEGER,
    artist_id INTEGER,
    item_name TEXT,
    amount_cents INTEGER,
    stripe_session_id TEXT UNIQUE,
    stripe_payment_intent_id TEXT,
    connected_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'paid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.music_purchases
    ADD COLUMN IF NOT EXISTS studio_track_id UUID,
    ADD COLUMN IF NOT EXISTS studio_album_id UUID,
    ADD COLUMN IF NOT EXISTS seller_profile_id UUID,
    ADD COLUMN IF NOT EXISTS transfer_group TEXT,
    ADD COLUMN IF NOT EXISTS splits_applied BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

CREATE INDEX IF NOT EXISTS idx_music_purchases_studio_track
    ON public.music_purchases(studio_track_id) WHERE studio_track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_music_purchases_studio_album
    ON public.music_purchases(studio_album_id) WHERE studio_album_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_music_purchases_buyer
    ON public.music_purchases(buyer_user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. artists backfill — the profile -> artist lookup
--
--    Public artist pages resolve by `artists.slug` and filter
--    `is_published = true`. src/lib/artist.ts::ensureArtistRow inserts
--    with is_published = false, so an artist who self-serve-uploaded
--    had no reachable public profile — their name could not link
--    anywhere. Create the missing rows and publish any artist who
--    actually has published tracks.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_artists_profile_id
    ON public.artists(profile_id);

DO $$
DECLARE
    rec RECORD;
    base_slug TEXT;
    candidate TEXT;
    n INTEGER;
    seed_name TEXT;
    created INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT DISTINCT t.profile_id
        FROM public.studio_tracks t
        WHERE t.profile_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.artists a WHERE a.profile_id = t.profile_id
          )
    LOOP
        SELECT COALESCE(
                   NULLIF(btrim(p.display_name), ''),
                   NULLIF(btrim(p.full_name), ''),
                   NULLIF(btrim(p.username), ''),
                   'MELORI Artist'
               )
          INTO seed_name
          FROM public.profiles p
         WHERE p.id = rec.profile_id;

        seed_name := COALESCE(seed_name, 'MELORI Artist');

        base_slug := regexp_replace(lower(seed_name), '[^a-z0-9]+', '-', 'g');
        base_slug := btrim(base_slug, '-');
        IF base_slug = '' THEN base_slug := 'artist'; END IF;
        base_slug := left(base_slug, 40);

        candidate := base_slug;
        n := 1;
        WHILE EXISTS (SELECT 1 FROM public.artists a WHERE a.slug = candidate) LOOP
            candidate := base_slug || '-' || left(rec.profile_id::text, 6) ||
                         CASE WHEN n = 1 THEN '' ELSE '-' || n::text END;
            n := n + 1;
        END LOOP;

        INSERT INTO public.artists (name, slug, profile_id, is_published)
        VALUES (seed_name, candidate, rec.profile_id, false);
        created := created + 1;
    END LOOP;

    RAISE NOTICE 'artists backfill created % row(s) for studio uploaders', created;
END $$;

-- Publish artists who have at least one published studio track. Without
-- this their /artists/<slug> page 404s and every name link on the site
-- would be dead.
UPDATE public.artists a
SET is_published = true
WHERE a.is_published IS DISTINCT FROM true
  AND EXISTS (
      SELECT 1 FROM public.studio_tracks t
      WHERE t.profile_id = a.profile_id AND t.status = 'published'
  );

-- ---------------------------------------------------------------------
-- 7. Row Level Security (defense-in-depth)
--
--    Every write path runs through the service-role client, which
--    BYPASSES RLS — ownership is primarily enforced in application code
--    (src/lib/studio-ownership.ts). These policies mirror the
--    studio_tracks convention (migration 008) so a direct anon/user-key
--    query can never read or write another artist's prices or splits.
-- ---------------------------------------------------------------------

-- studio_albums: public can read, owner can write, admin full control.
ALTER TABLE public.studio_albums ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read studio albums" ON public.studio_albums;
CREATE POLICY "Public read studio albums"
    ON public.studio_albums FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Artists insert own studio albums" ON public.studio_albums;
CREATE POLICY "Artists insert own studio albums"
    ON public.studio_albums FOR INSERT
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Artists update own studio albums" ON public.studio_albums;
CREATE POLICY "Artists update own studio albums"
    ON public.studio_albums FOR UPDATE
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Artists delete own studio albums" ON public.studio_albums;
CREATE POLICY "Artists delete own studio albums"
    ON public.studio_albums FOR DELETE
    USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins all access studio_albums" ON public.studio_albums;
CREATE POLICY "Admins all access studio_albums"
    ON public.studio_albums FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- revenue_splits: private. Only the configuring artist and the payee can
-- see a split; only the configuring artist can change it.
ALTER TABLE public.revenue_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Artists read own revenue splits" ON public.revenue_splits;
CREATE POLICY "Artists read own revenue splits"
    ON public.revenue_splits FOR SELECT
    USING (owner_id = auth.uid() OR payee_profile_id = auth.uid());

DROP POLICY IF EXISTS "Artists insert own revenue splits" ON public.revenue_splits;
CREATE POLICY "Artists insert own revenue splits"
    ON public.revenue_splits FOR INSERT
    WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Artists update own revenue splits" ON public.revenue_splits;
CREATE POLICY "Artists update own revenue splits"
    ON public.revenue_splits FOR UPDATE
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Artists delete own revenue splits" ON public.revenue_splits;
CREATE POLICY "Artists delete own revenue splits"
    ON public.revenue_splits FOR DELETE
    USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Admins all access revenue_splits" ON public.revenue_splits;
CREATE POLICY "Admins all access revenue_splits"
    ON public.revenue_splits FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- split_payouts: read-only ledger. Written exclusively by the webhook
-- via the service-role client; no user-key INSERT/UPDATE policy exists,
-- so the audit trail cannot be forged or rewritten from the browser.
ALTER TABLE public.split_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Payees read own split payouts" ON public.split_payouts;
CREATE POLICY "Payees read own split payouts"
    ON public.split_payouts FOR SELECT
    USING (payee_profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins all access split_payouts" ON public.split_payouts;
CREATE POLICY "Admins all access split_payouts"
    ON public.split_payouts FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
