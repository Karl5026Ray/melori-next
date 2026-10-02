# MM Spaces redesign + room separation, 2 Oct 2026

Karl: "make it similar and fix the current issues", same purple/teal look as
the Cinema prototype, and Spaces and Cinema "not connected in any way" (he
chose: separate code, same colors; shared plumbing stays).

Audit before (realistic room: host, 2 speakers, 43 listeners, 1 raised hand,
390px phone): ~240px of visible room; 2,160px participant list; raised hands
below every listener; duplicate speaker list; chat overlay with no history or
delete; follow "+" on people already followed; mods had no UI; Report was an
alert(); reminders never sent; "followed" hand-raise mode was a TODO.

## Done
- [x] Separate code: `spaces/SpacesRoomScreen.tsx` (new) and
      `cinema/CinemaRoomScreen.tsx` (was the shared rooms/RoomScreen.tsx, now
      Cinema-only). Spaces' own SpacesStage / SpacesListeners / SpacesChat /
      useSpaceChat / spacesRoom / spacesAvatar / spacesRoomRoute; Cinema's own
      cinemaAvatar. `scripts/spaces-room.test.ts` fails if either imports the
      other. Old StageGrid + RoomCommentOverlay deleted.
- [x] Spaces layout: one-line header (LIVE, title, head count), stage with
      live speaking rings (loudness added to livekitClient), listeners strip
      with "See all", persistent chat, dock (Leave quietly, hands queue,
      reactions, mic / hand). App header + tab bar hidden inside a room.
- [x] Stage cap: host + 8 speakers, server-side (409). Nobody but the host
      joins on stage (tier auto-seat bypassed the cap).
- [x] One person sheet: follow/unfollow, react, and stage tools for host AND
      moderators; host-only make-moderator and remove-and-ban.
- [x] Follow state loaded in one query (Spaces) / host follow loaded (Cinema).
- [x] Report: room + chat line, both screens; report API takes `space` and
      `space_chat` and emails Karl.
- [x] Reminders: `/api/cron/space-reminders` every 5 min, emails once when a
      room goes live or starts within 10 min; respects email opt-out.
- [x] "Followed" hand-raise mode works (route checks follows host -> caller).
- [x] Prototype colors on both rooms: colored initials, purple host ring,
      teal speaking rings, red LIVE chip, purple buttons. Gold removed from
      the Cinema room (screen, picker, seats, chat).

## Review
- `tsc --noEmit` clean; full `npm run test:unit` green (new spaces-room
  suite 44 checks; superseded assertions carry their reason).
- Browser: spaces-room 4/4, spaces-mobile-layout 14/14, cinema 4/4 (phone +
  desktop).
- Not done: the Cinema listing/create pages keep their gold look; pinned
  link; co-host role; reconnect-keeps-seat.

# Cinema podcast room + Spaces parity, 1 Oct 2026

Goal: Cinema = shared screen on top, 3 audio-only seats below (host + 2),
persistent chat in the bottom space, Clubhouse-style dock. Prototype:
the "MM Cinema Podcast Room" artifact.

## Phase 1: Cinema room (one PR) — approved by Karl 1 Oct, built
- [x] Camera removed from Cinema: no toggle, no live-box dialog, no slot
      fetch/realtime, `autoEnableCamera: false`. `cinema-camera-slot` route +
      migration 057 left dormant (no DB change).
- [x] `CinemaStage` → 3 audio seats (avatar, LiveKit volume ring, mute badge,
      open seat). Seating rule in `src/lib/cinemaStage.ts`.
- [x] Mic for anyone on stage; raise hand for listeners (both were `!isCinema`).
- [x] Hands queue sheet (host + mods), seat tap → host moderation sheet,
      Stage cap 3 enforced server-side (participants route → 409).
      Tier no longer auto-seats artists/superfans in Cinema.
- [x] Persistent chat panel under the listeners, composer inside it;
      5-line fading overlay + its CSS deleted.
- [x] Chat moderation: DELETE `/comments/[commentId]` (host / mod / author),
      realtime DELETE drops the line everywhere; banned users get 403 on POST.
- [x] "Remove and ban from this room" in the host sheet (route had `ban` already).
- [x] Dock: Leave quietly bottom-left; host gets hand-off vs end-for-everyone.
- [x] Tests: `scripts/cinema-stage.test.ts` (30 checks, in test:unit);
      superseded camera-era assertions in `cinema-server-invariants` with
      reasons; `e2e/cinema-stable-room.spec.ts` rewritten (4/4 pass, mobile +
      desktop).

## Phase 2: Spaces gaps vs Clubhouse (separate PRs)
- [ ] Chat moderation: host/mod delete, ban check on POST, report.
- [ ] Real Report flow (replace the `alert()` placebo) → reports table.
- [ ] Ban UI reachable from the participant sheet (037_space_bans exists).
- [ ] Reminder delivery cron for `space_reminders` (never sent today).
- [ ] Pinned link (host sets, shows above chat).
- [ ] Co-host role UI + host hand-off on leave.
- [ ] Reconnect keeps your seat; "followed" hand-raise mode TODO; seed
      follow state.

## Review
- `tsc --noEmit` clean; full `npm run test:unit` green; Cinema e2e 4/4 green
  locally (Chromium 1194 via executablePath; repo config untouched).
- The e2e caught a real bug before Karl did: on a 664px-tall phone the chat
  was squeezed to ~30px. Fixed by clamping the screen to 28dvh, dropping the
  Cinema drag pills, and putting the listener count + circles on one line.
- Not done here (Phase 2): Report flow, reminder cron, pinned link, co-host
  UI, reconnect-keeps-seat, followed hand-raise mode.

# Site health sweep, 24 Sep 2026

Five issues from a live read-only audit of melorimusic.org. No reset or
redeploy was needed: production was already on the latest commit.

- [x] **#1 Moderation restored.** Cause: `CLOUDFLARE_AI_TOKEN` in Vercel was
      never a working Workers AI token. The 31 Aug value got 401 / 10000, and
      `CLOUDFLARE_ACCOUNT_ID` was also wrong. Karl corrected the account ID and
      set a new Workers AI token ("Melori moderation FINAL", Read + Edit).
      /api/health reports `cloudflare_ai_moderation: healthy` ("token
      accepted") on 24 Sep, 23:50 UTC. PR #396 now normalises both values and
      names paste mistakes in the health output.
- [x] **#2 Marketing aliases.** /signup, /sign-up, /join, /pricing →
      /register; /contact → /support. The signup wall stays as Karl decided
      on 7 Sep. No paid tiers, so "pricing" means free signup.
- [x] **#3 Sitemap** lists /mission instead of /about, which is a 308.
- [x] **#4 Health check sees the stack.** Added Supabase (auth + rest),
      Cloudflare Workers AI (model listing, no inference cost), LiveKit and
      Resend checks. The scheduled run (CRON_SECRET) emails Karl when anything
      is unhealthy. Cron now runs every 6h instead of daily.
      `npm run test:health` has 26 checks and is in test:unit.
- [x] **#5 DB performance.** Migration 085 applied to production: 71 RLS
      policies wrapped as InitPlans, and 3 duplicate indexes dropped.
      Verified: still 170 policies, identical shape md5 and identical
      normalised logic md5, 0 bare calls left. The advisor no longer reports
      auth_rls_initplan or duplicate_index.
      Not done, by Karl's choice: play-counter lockdown, and merging the 172
      overlapping permissive policies.

## Review

- Full `npm run test:unit` passes and `tsc --noEmit` is clean.
- Left alone on purpose: `is_conversation_member(uuid)` is flagged by the
  advisor, but it is the caller-only helper from 082 that the DM policies
  need.
- Still open: four `_backup_*` tables in `public` (from 5–6 Sep). They are
  not reachable by anon or authenticated. Drop them once Karl confirms they
  are no longer needed.

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
