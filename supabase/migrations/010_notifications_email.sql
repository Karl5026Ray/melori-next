-- 010_notifications_email.sql
-- Adds the email-notification preference read/written by /settings and
-- /api/user/settings. Additive + idempotent; existing rows default to opted-in
-- (matches the app's default of true). No RLS change: the existing
-- "Users update own profile" policy already covers this column.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notifications_email boolean NOT NULL DEFAULT true;
