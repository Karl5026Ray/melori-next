-- RECOVERED 068_apple_iap
--
-- This file was missing from supabase/migrations/ while the migration was
-- already applied to production. The SQL below is the exact text recorded in
-- supabase_migrations.schema_migrations for version 20260902130237, recovered
-- verbatim -- it is not a reconstruction from the live schema.
--
-- Already applied. Do not re-apply. See scripts/migration-prefix.test.ts for
-- the gap check that now makes this class of drift fail CI.

create table if not exists public.apple_iap_events (
  id bigserial primary key,
  notification_uuid text not null,
  notification_type text not null,
  subtype text,
  original_transaction_id text,
  transaction_id text,
  web_order_line_item_id text,
  product_id text,
  bundle_id text,
  environment text,
  tier text,
  "interval" text,
  status text,
  expires_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists apple_iap_events_notification_uuid_idx
  on public.apple_iap_events (notification_uuid);
create index if not exists apple_iap_events_original_txn_idx
  on public.apple_iap_events (original_transaction_id, created_at desc);

alter table public.apple_iap_events enable row level security;
revoke all on public.apple_iap_events from anon, authenticated;

alter table public.profiles
  add column if not exists apple_original_transaction_id text;

create unique index if not exists profiles_apple_original_txn_idx
  on public.profiles (apple_original_transaction_id)
  where apple_original_transaction_id is not null;

alter table public.membership_tiers
  add column if not exists apple_product_id_monthly text,
  add column if not exists apple_product_id_yearly text;

alter table public.coin_packs
  add column if not exists apple_product_id text;

create unique index if not exists coin_packs_apple_product_id_idx
  on public.coin_packs (apple_product_id)
  where apple_product_id is not null;
