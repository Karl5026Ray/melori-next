-- Migration 007: Membership columns + events table
-- ============================================================
-- The members Stripe webhook (src/app/api/members/stripe-webhook/route.ts)
-- reads/writes membership subscription state onto public.profiles and logs
-- every processed event into public.membership_events. Migration 001 only
-- created profiles.role + profiles.membership_status, so the webhook UPDATE
-- and the membership_events insert both fail silently -- paying members are
-- never activated and stay gated to the free (30s sample) experience.
--
-- This migration is additive: it adds the missing columns/table the webhook
-- already expects. Nothing existing is dropped or altered.
-- ============================================================

-- 1. Subscription state columns on profiles ------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS membership_tier        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS membership_interval    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS membership_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS membership_updated_at  TIMESTAMPTZ DEFAULT NOW();

-- Lookups the webhook performs when linking Stripe -> profile.
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON public.profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription_id
  ON public.profiles(stripe_subscription_id);

-- 2. Event audit / idempotency table -------------------------
CREATE TABLE IF NOT EXISTS public.membership_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id        TEXT NOT NULL UNIQUE,
  event_type             TEXT NOT NULL,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  customer_email         TEXT,
  tier                   TEXT,
  interval               TEXT,
  status                 TEXT,
  amount_total           INTEGER,
  current_period_end     TIMESTAMPTZ,
  raw                    JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_events_customer
  ON public.membership_events(stripe_customer_id);

-- Service-role webhook writes bypass RLS; enable RLS with no public policy
-- so the audit log is not readable by clients.
ALTER TABLE public.membership_events ENABLE ROW LEVEL SECURITY;
