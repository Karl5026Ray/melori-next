-- RECOVERED 077_site_asset_upload_tokens
--
-- This file was missing from supabase/migrations/ while the migration was
-- already applied to production. The SQL below is the exact text recorded in
-- supabase_migrations.schema_migrations for version 20260911025923, recovered
-- verbatim -- it is not a reconstruction from the live schema.
--
-- Already applied. Do not re-apply. See scripts/migration-prefix.test.ts for
-- the gap check that now makes this class of drift fail CI.

create table if not exists public.site_asset_upload_tokens (
  token_hash  text primary key,
  path        text not null check (path ~ '^site/[a-z0-9][a-z0-9-]{0,62}\.(mp3|jpg|jpeg|png|webp)$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);

alter table public.site_asset_upload_tokens enable row level security;
revoke all on table public.site_asset_upload_tokens from anon, authenticated;

comment on table public.site_asset_upload_tokens is
  'Single-use, path-bound, expiring tokens for POST /api/admin/site-asset-upload. Stores token hashes only. Service role only.';
