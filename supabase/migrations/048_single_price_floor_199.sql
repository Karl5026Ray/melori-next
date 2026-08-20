-- ---------------------------------------------------------------------
-- 048 — Raise the standard single price from $0.99 to $1.99
--
-- WHY
--   Melori promises that music sales carry no platform cut and the artist
--   keeps every dollar after payment processing. At $0.99 that promise is
--   thin: Stripe charges 2.9% + $0.30 per transaction, so a $0.99 single
--   nets the artist $0.66 — 67% of the sale, with the flat $0.30 taking
--   roughly a third of it. At $1.99 the same fee structure nets $1.63,
--   about 82%, and the "no platform cut" claim reads as intended.
--
-- WHAT
--   1. studio_tracks.price_cents: default 99 -> 199, and reprice existing
--      rows that are still sitting on the old default of exactly 99.
--   2. legacy `tracks` / `releases` DECIMAL dollar prices: 0.99 -> 1.99.
--
-- WHAT THIS DOES NOT DO
--   • Does not touch albums ($9.99 stays $9.99).
--   • Does not touch free items (price 0) — free stays free.
--   • Does not touch any deliberately custom price (e.g. 1.49, 2.99):
--      only exact old-default values are moved, so an artist who chose a
--      price keeps it.
-- ---------------------------------------------------------------------

BEGIN;

-- 1. Artist-uploaded singles (integer cents, authoritative for checkout).
ALTER TABLE public.studio_tracks
    ALTER COLUMN price_cents SET DEFAULT 199;

UPDATE public.studio_tracks
   SET price_cents = 199
 WHERE price_cents = 99;

COMMENT ON COLUMN public.studio_tracks.price_cents IS
    'Artist-set single price in integer cents. Default 199 ($1.99) — below ~$1.99 Stripe''s flat $0.30 per transaction takes a disproportionate share of the sale. 0 = free download. Authoritative for checkout — never trust a browser-supplied price.';

-- 2. Legacy admin-curated catalog, priced in DECIMAL dollars.
--    Guarded so the migration is safe whether or not the column exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'price'
    ) THEN
        EXECUTE 'UPDATE public.tracks SET price = 1.99 WHERE price = 0.99';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'releases' AND column_name = 'price'
    ) THEN
        EXECUTE 'UPDATE public.releases SET price = 1.99 WHERE price = 0.99';
    END IF;
END $$;

COMMIT;

-- Verification (run manually after applying):
--   SELECT price_cents, count(*) FROM public.studio_tracks GROUP BY 1 ORDER BY 1;
--   SELECT price, count(*) FROM public.releases GROUP BY 1 ORDER BY 1;
