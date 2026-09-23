# Apple In-App Purchase — Melori Music iOS 1.0.2

Guideline 3.1.1. PR #339 made commerce unreachable in the wrapper; it did not
work, because the leak was never a route. This branch fixes what actually
leaked and settles the music question.

## Done on this branch

- [x] Commerce affordances: every price and purchase CTA outside a
      proxy-blocked route carries `data-native-hide`, so the pre-paint CSS in
      `native-app.css` removes it inside the wrapper.
      `scripts/native-commerce-affordances.test.ts` is generative and fails on
      any new one — it reproduced all eight live leaks before the fix.
- [x] Music and photo downloads are web-only — `/music/success`,
      `/gallery/purchase`, `/download-success` and the two signed-URL download
      APIs are refused for native requests. No IAP for music, so Stripe Connect
      artist payouts are untouched.
- [x] Snappd is a real tier: `classifyPrice()` maps 1499/14999,
      `membership.ts` grants it studio + gallery access, and migration 069 lets
      `profiles.role` hold it. Applied to production and verified. No backfill
      — confirmed nobody had bought it while the door was open.

## Confirmed in App Store Connect, 2 Sep 2026

- [x] iOS 1.0.2 build 21 is **Rejected**, submission 6c0eeca5, two 3.1.1
      findings: donations via a non-IAP mechanism, and the app accessing music
      purchased outside the app that is not purchasable via IAP (citing
      3.1.3(b)).
- [x] Paid Applications Agreement **Active**, US bank account **Active**,
      W-9 **Active**. IAP products can be created whenever they are wanted.
- [x] App Store Small Business Program enrollment submitted (15% rate).

## Follow-up branch — the Apple IAP server rail

Built and tested but held out of this branch: it adds a dependency
(`@apple/app-store-server-library`) and therefore a `package-lock.json`
update. Land it with a normal `git push` after an `npm install`.

- [ ] Migration `068_apple_iap.sql` — already APPLIED to production; the file
      still needs to land in the repo so the folder matches the ledger.
- [ ] `src/lib/iap-apple.ts` — JWS verification, explicit product→tier map
      with no amount fallback.
- [ ] `src/app/api/iap/apple/notifications/route.ts` — ASSN v2 endpoint
      mirroring `/api/members/stripe-webhook`.
- [ ] `appleCoinPackCreditReference()` in `src/lib/gifting.ts`.
- [ ] `scripts/apple-iap.test.ts` (43 checks) + its `test:unit` entry.

## Next — not started

- [ ] Reply to App Review requesting bug-fix approval of 1.0.2. Only after the
      browser sweep is re-run against production and the leaked strings are
      confirmed gone.
- [ ] Un-gate physical goods. Guideline 3.1.5(a) *requires* merch and photo
      bookings to use non-IAP payment, so `/store`, `/cart`, `/checkout` and
      `/book` should come out of `BLOCKED_PAGE_PREFIXES` and run on Stripe
      inside the app.
- [ ] Capacitor StoreKit plugin + native purchase/restore flow. Must come from
      npm: `ios/` and `android/` are git-ignored and regenerated.
- [ ] `appAccountToken` must be set to the signed-in Supabase user id on every
      purchase. Without it a consumable cannot be attributed to a wallet —
      Apple sends no email.
- [ ] Sandbox end-to-end: purchase, renewal, refund, restore, replay.

---

# Click-to-replace cover art (studio_tracks) — branch `cover-click-to-replace`

- [x] `src/lib/cover-url.ts` — pure helpers: parse a `covers` public URL to its
      storage path; validate (project host, `covers` bucket, no traversal,
      optional `studio/<ownerId>/` scope).
- [x] `src/lib/studio-covers.ts` — best-effort delete of the old cover ONLY when
      no studio_tracks / studio_albums / releases / artists row still points at
      it (the Relaunch album shares one cover across 14 tracks).
- [x] Studio: GET /api/studio/tracks selects `cover_url`; PATCH
      /api/studio/track/[id] accepts an owner-scoped `cover_url`.
- [x] Studio TrackList: real cover tile, click → pick image → upload → save.
- [x] Admin: PATCH /api/admin/studio-tracks/[id] accepts any `covers` URL;
      /admin/uploads cover tile is click-to-replace.
- [x] Fix the misleading "owner or admin" comment in the studio PATCH route.
- [x] `scripts/cover-url.test.ts` + `test:cover-url` in `test:unit`; run the
      whole unit suite, `tsc --noEmit`, `next lint`.

## Review
- Unit suite green (all suites incl. new `test:cover-url`, 36 checks); `tsc --noEmit` clean.
- `next build` could not run in the sandbox (Google Fonts fetch blocked) — the
  Vercel preview build is the compile check. Manually test on the preview:
  Studio → click a cover → pick image; /admin/uploads → same.
- Shared covers (Relaunch album) are kept on replace AND on track delete
  (both DELETE routes used to remove the cover unconditionally, which would
  have wiped the album art for every other track); only unreferenced objects
  are deleted.
