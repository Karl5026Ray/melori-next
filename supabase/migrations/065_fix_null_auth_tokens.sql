-- 065_fix_null_auth_tokens.sql
--
-- APPEND-ONLY MIGRATION: do not edit a migration after it is applied.
--
-- RECONCILIATION FILE. This migration was applied directly to production on
-- 2026-08-13 (ledger version 20260813215144, name "065_fix_null_auth_tokens")
-- as a hotfix, and was never checked in. It is captured here verbatim from
-- supabase_migrations.schema_migrations so that the repository and the
-- production ledger agree on what prefix 065 means, and so a fresh
-- environment reproduces production. Re-running it is a no-op: every
-- statement is an idempotent UPDATE with an `is null` guard.
--
-- The Concert instrument-gift migration that was originally authored as 065
-- moved to 066 for the same reason -- prefix 065 was already spent here. See
-- 066_concert_instrument_gifts_and_scores.sql and
-- scripts/migration-prefix.test.ts for why unique prefixes matter.
--
-- ORIGINAL HOTFIX NOTES (unchanged):
--
-- GoTrue's admin.listUsers() (and some single-user lookups) scan these columns
-- into non-nullable Go strings. A NULL value throws:
--   "Scan error on column index 3, name confirmation_token: converting NULL to string is unsupported"
-- 60 of 168 auth.users rows have NULL in confirmation_token / recovery_token /
-- email_change_token_new, confirmed live in production logs as repeated 500s on
-- GET /admin/users. Empty string is functionally identical to NULL for these
-- columns (only read transiently during confirm/recovery/email-change flows)
-- but satisfies the non-nullable scan.

update auth.users set confirmation_token = '' where confirmation_token is null;
update auth.users set recovery_token = '' where recovery_token is null;
update auth.users set email_change_token_new = '' where email_change_token_new is null;
