-- 068_apple_iap_purchases.sql
-- ---------------------------------------------------------------------
-- Apple In-App Purchase support for music sales made inside the native
-- iOS app (Guideline 3.1.1 / 3.1.3(b) remediation).
--
-- Web purchases are completely unaffected: this only adds columns and
-- a parallel ledger path. Nothing here changes Stripe checkout, splits,
-- or payouts for melorimusic.org.
--
-- Money model: an iOS buyer pays an Apple-fixed tier price. Apple takes
-- its commission (15% under the Small Business Program) before paying
-- Melori's developer account. The artist is still owed their full
-- listed price, same as a web sale -- Melori covers the difference by
-- picking a tier high enough that (tier * 0.85) >= artist price, and
-- reconciles the artist's owed amount via the existing split_payouts
-- ledger (status 'owed'), paid out by hand/Connect transfer, same as
-- an un-onboarded-artist web sale already works today.
-- ---------------------------------------------------------------------

ALTER TABLE public.music_purchases
ADD COLUMN IF NOT EXISTS payment_processor TEXT NOT NULL DEFAULT 'stripe',
ADD COLUMN IF NOT EXISTS apple_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS apple_product_id TEXT,
ADD COLUMN IF NOT EXISTS apple_environment TEXT,
ADD COLUMN IF NOT EXISTS artist_owed_cents INTEGER;

DO $$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'music_purchases_payment_processor_valid'
  ) THEN
ALTER TABLE public.music_purchases
ADD CONSTRAINT music_purchases_payment_processor_valid
CHECK (payment_processor IN ('stripe', 'apple_iap'));
END IF;
END $$;

DO $$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'music_purchases_apple_environment_valid'
  ) THEN
ALTER TABLE public.music_purchases
ADD CONSTRAINT music_purchases_apple_environment_valid
CHECK (apple_environment IS NULL OR apple_environment IN ('Sandbox', 'Production'));
END IF;
END $$;

-- One fulfilment per Apple transaction, ever -- makes webhook/verify
-- replay a no-op instead of double-granting access.
CREATE UNIQUE INDEX IF NOT EXISTS uq_music_purchases_apple_transaction
ON public.music_purchases(apple_transaction_id)
WHERE apple_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.music_purchases.payment_processor IS
'stripe (web) or apple_iap (native app). Determines which columns below are populated.';
COMMENT ON COLUMN public.music_purchases.artist_owed_cents IS
'For apple_iap rows: the artist''s full listed price, owed via the split_payouts ledger since Apple cannot route funds to the artist''s Connect account directly.';

-- split_payouts already models "money owed to a payee that Stripe could
-- not deliver automatically" (status = owed). Reuse it for the IAP owed
-- amount instead of inventing a second ledger. Add the Apple transaction
-- id so a payout row can be traced back to its sale and de-duplicated
-- the same way stripe_payment_intent_id already is.
ALTER TABLE public.split_payouts
ADD COLUMN IF NOT EXISTS apple_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_split_payouts_apple_transaction
ON public.split_payouts(apple_transaction_id)
WHERE apple_transaction_id IS NOT NULL;

-- Verification (run manually after applying):
-- SELECT payment_processor, count(*) FROM public.music_purchases GROUP BY 1;
