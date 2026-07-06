-- 011_artist_payouts_status.sql
-- Adds Stripe Connect (Express) account status columns to the existing
-- public.artist_payouts table. Additive + idempotent: only ADD COLUMN IF NOT
-- EXISTS, so it is safe to re-run and never touches existing data.
--
-- artist_payouts already has: id, artist_id (→ artists.id), stripe_connect_account_id,
-- is_onboarded, created_at. The onboarding/status routes and the account.updated
-- Connect webhook write the mirrored capability flags below so the Studio UI can
-- render payout state without hitting Stripe on every load.

ALTER TABLE public.artist_payouts
  ADD COLUMN IF NOT EXISTS charges_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.artist_payouts
  ADD COLUMN IF NOT EXISTS payouts_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.artist_payouts
  ADD COLUMN IF NOT EXISTS details_submitted boolean NOT NULL DEFAULT false;

ALTER TABLE public.artist_payouts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- One payout account per artist. Idempotent guard: only add the unique index if
-- it isn't already present.
CREATE UNIQUE INDEX IF NOT EXISTS artist_payouts_artist_id_key
  ON public.artist_payouts (artist_id);
