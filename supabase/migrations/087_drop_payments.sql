-- 087_drop_payments.sql
--
-- Apply ONLY after the code that stops reading these is deployed, and after a backup.
--
-- Melori charges nothing: no memberships, no subscriptions, no store, no
-- per-track or per-album prices, no photo sales and no gift coins. The
-- application code no longer reads or writes any object below (verified by
-- grepping src/ and scripts/ for every name in this file). This migration
-- removes the schema that supported money.
--
-- It is destructive and not reversible from the repo: order, purchase, payout,
-- wallet and gift history is deleted. Take a backup (or pg_dump these tables)
-- first if any of that history must be kept for tax or legal records.
--
-- Every statement is `if exists`, so it is safe on an environment where some
-- of these objects were never created (several were made by hand in the
-- Supabase console and have no create statement in this repo). Column drops
-- are deliberately NOT `cascade`: if a hand-made view or policy in production
-- still depends on one of these columns, the migration fails and rolls back
-- rather than silently dropping that object. Inspect and remove it, then rerun.

-- ---------------------------------------------------------------------------
-- 1. Functions that read the tables below. Dropped first and explicitly:
--    SQL/plpgsql function bodies are not dependency-tracked, so `cascade` on
--    the tables would leave them behind, broken.
-- ---------------------------------------------------------------------------
drop function if exists public.spend_coins_on_gift(uuid, uuid, uuid, uuid);
drop function if exists public.credit_wallet(uuid, integer, text);
-- 066's display aggregate over gift_sends; replaced by concert_votes (086).
drop function if exists public.concert_battle_gift_totals(uuid);

-- ---------------------------------------------------------------------------
-- 2. Tables. `cascade` also drops their policies, indexes, triggers and any
--    foreign keys pointing at them (e.g. order_items -> releases).
-- ---------------------------------------------------------------------------
-- Gifts and coins (058, 063, 064, 066, 068)
drop table if exists public.gift_sends cascade;
drop table if exists public.gifts cascade;
drop table if exists public.wallet_transactions cascade;
drop table if exists public.wallets cascade;
drop table if exists public.coin_packs cascade;

-- Store / music sales and payouts (001, 011, 046)
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.music_purchases cascade;
drop table if exists public.split_payouts cascade;
drop table if exists public.revenue_splits cascade;
drop table if exists public.artist_payouts cascade;

-- Photo sales (035)
drop table if exists public.photo_gallery_purchases cascade;

-- Apple in-app purchase ledger (068)
drop table if exists public.apple_iap_events cascade;

-- ---------------------------------------------------------------------------
-- 3. Price columns.
-- ---------------------------------------------------------------------------
-- Artist self-upload pricing (046, 048). The range constraints go with them.
alter table if exists public.studio_tracks
  drop column if exists price_cents,
  drop column if exists currency;
alter table if exists public.studio_albums
  drop column if exists price_cents,
  drop column if exists currency;

-- Legacy catalog prices, DECIMAL dollars (001, 048).
alter table if exists public.releases drop column if exists price;
alter table if exists public.tracks drop column if exists price;

-- Photo gallery for-sale flag and price (035).
alter table if exists public.photo_gallery_images
  drop column if exists for_sale,
  drop column if exists price_cents;

-- Concert round coin/gift totals (060). Rounds are scored on
-- initiator_votes / opponent_votes since 086.
alter table if exists public.concert_battle_rounds
  drop column if exists initiator_coins_total,
  drop column if exists opponent_coins_total,
  drop column if exists initiator_gift_count,
  drop column if exists opponent_gift_count;

-- ---------------------------------------------------------------------------
-- 4. Membership / billing columns on profiles. profiles.role stays: it still
--    carries 'admin', which gates the admin panel.
-- ---------------------------------------------------------------------------
alter table if exists public.profiles
  drop column if exists membership_tier,
  drop column if exists membership_status,
  drop column if exists membership_expires_at,
  drop column if exists membership_interval,
  drop column if exists membership_updated_at,
  drop column if exists billing_exempt,
  drop column if exists is_comp;
