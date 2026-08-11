# Gifting MVP implementation handoff

## Delivered

- Concert routes directly to `/social/spaces/create?format=versus_battle`; the
  existing create form validates the query and selects Versus Battle.
- Migration `058_gifting_wallet_and_catalog.sql` reconciles the wallet ledger,
  catalog, idempotent wallet credit/spend functions, RLS/grants, catalog seeds,
  and the `orders.status='paid'` constraint.
- Authenticated gift catalog, wallet, send, and coin-pack checkout routes were
  added. Gift spending rechecks a live Concert room, active sender, and a valid
  host/speaker target before its atomic RPC call.
- The merged Stripe webhook recognizes `melorimusic.org/coin-pack`, rereads the
  pack, checks paid amount, credits with a Stripe-session ledger reference, and
  returns 500 only for idempotent coin-credit failures. Existing one-time
  products preserve their prior retry behavior.
- Concert-only GiftPicker and GiftOverlay use the existing PubNub room channel.
  Gift overlays are server-announced only after the wallet RPC succeeds.
- Thirteen selected uploaded MP4s are in `public/gifts`; all are below 100 MB.
- Mobile and desktop Concert buttons open the Versus Battle create flow instead
  of showing the old coming-soon notice.
- Mobile navigation restructuring, transport padding, and Mirror 9:16 work are
  intentionally deferred to a separate defect PR.

## Validation

- `git diff --check` passed.
- Asset verification: 13 catalog files, maximum 16,375,431 bytes.
- Added `scripts/gifting.test.ts` for media rendering, Concert gating, and
  coin-pack metadata/reference idempotency contracts.
- `npm run test:gifting`, `npm run test:migration-prefix`,
  `npx tsx scripts/media-capture.test.ts`,
  `npx tsx scripts/video-mirror.test.ts`, and `npm run test:cinema` passed.
- `npm run build` completed compilation and TypeScript checking, then stopped
  during prerender of the existing `/video` page because this checkout has no
  local Supabase environment values. No build error originated in the gifting
  changes.
