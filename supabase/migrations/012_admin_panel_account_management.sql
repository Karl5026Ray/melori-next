-- Migration 012: admin_panel_account_management
--
-- NOTE: This migration is ALREADY APPLIED in the live database. It is committed
-- here only to keep the repo's schema history complete. Every statement is
-- idempotent (IF NOT EXISTS) so re-running is a no-op and safe.
--
-- Additive-only. Supports the User/Artist management admin panel:
--   * account lifecycle columns on profiles (status / soft-delete / reasons)
--   * an audit trail table for admin write actions

-- 1) profiles: account status + soft-delete + reasons ------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_reason text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('active', 'suspended', 'deleted'));
  END IF;
END $$;

-- 2) admin_activity_logs: audit trail ---------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_activity_logs_created_at_idx
  ON public.admin_activity_logs (created_at DESC);

-- RLS: admins (profiles.role='admin') can read. Writes happen via the
-- service-role client, which bypasses RLS.
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'admin_activity_logs'
      AND policyname = 'admin_activity_logs_admin_select'
  ) THEN
    CREATE POLICY admin_activity_logs_admin_select
      ON public.admin_activity_logs
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
  END IF;
END $$;
