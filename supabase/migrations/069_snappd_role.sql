-- 069_snappd_role.sql
--
-- Lets `profiles.role` hold 'snappd'.
--
-- THE BUG THIS CLOSES
-- The Snappd photographer membership ($14.99/mo, $149.99/yr) has been on sale
-- the whole time: an active row in membership_tiers with live Stripe payment
-- links on both intervals, and a tile on /register. But the tier existed
-- nowhere in the entitlement path:
--
--   * classifyPrice() in src/lib/membership-sync.ts had no 1499/14999 case, so
--     a Snappd buyer fell through to its final safety net — "any positive
--     recurring amount grants at least Superfan" — and was provisioned as a
--     $2.99 Superfan. Three times the price, a fifth of the product.
--   * This CHECK constraint only allowed free | superfan | artist | admin, so
--     even once the classifier is fixed, writing role = 'snappd' would raise
--     23514. The members webhook returns 500 on a failed membership write so
--     Stripe retries, which means the failure mode after fixing ONLY the code
--     would be an infinite retry loop against a customer who has already been
--     charged. The code fix and this migration have to ship together.
--
-- Checked against production before writing this: membership_events holds no
-- event with amount_total in (1499, 14999) and no unclassifiable positive
-- amount at all, and no profile carries a snappd role. Nobody bought it while
-- the door was open, so there is no backfill — this is purely forward-looking.
--
-- Snappd sits ABOVE Artist in price, and src/lib/membership.ts grants it
-- studio-and-gallery access accordingly (isArtistSubscriber), because galleries,
-- tethering and instant print sales are exactly what it is sold on.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role::text = any (array['free','superfan','artist','snappd','admin']::text[]));
