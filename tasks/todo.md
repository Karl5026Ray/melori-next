# Door conversion + privacy gaps, 2 Oct 2026 (A, B done; C next)

Source: an outside review of melorimusic.org, checked against the live site
and main (5e9b630). Kept: the parts that held up. Dropped: "Loading… stuck"
(it is the sr-only label on `app/loading.tsx`'s spinner, streamed before the
page in the same response; real visitors see a brief spinner) and "/explore,
/chat broken" (those routes never existed; the tab bar labels Explore and
Chat point at `/music` and `/social/messages`).

## A. Signed-out visitors bounce with no explanation (review item 2)
Today, signed out: `/music` and `/social/messages` (the tab bar's Explore and
Chat) and any made-up URL 307 to `/platform` (the sign-up door). Spaces,
Cinema, Faces and Radio already do it right: each sends you to a public page
that explains the product (`teaserFor` in `src/proxy.ts`, `FeatureTeaser`).

- [x] A1. New public teaser `src/app/listen/page.tsx` built on `FeatureTeaser`:
      what the catalog is (free to members, Karl Ray / Kaiel R / Gloria Joy
      Rivers and more), 3 points, one CTA to the door. Add `/listen` to
      PUBLIC_EXACT; map `/music` → `/listen` in TEASER_FOR.
      (Not making `/music` itself public: the catalog stays a members' perk.)
- [x] A2. `/social/messages` → `/platform?reason=chat` (no teaser page; a DM
      inbox has nothing to preview). The door reads `reason` and shows one
      line above the form: "Sign in to see your messages."
- [~] A3. SKIPPED (security over polish). Unknown paths: leave the door redirect for signed-out (keeps every
      gated path private without a list), but return a real 404 for paths
      that match no route AND no gated prefix. Investigate first: the proxy
      can't see Next's route table, so this may need a small list of known
      top-level segments. If that list would drift, SKIP A3 and say so.
- [x] Tests: extend `scripts/signup-wall.test.ts` (TEASERS table:
      `/music` → `/listen`; `/listen` public; `/social/messages` reason
      param). e2e: signed-out tap on the tab bar's Explore lands on /listen.

## B. The door sells nothing above the form (review item 4, the big one)
`src/app/platform/page.tsx` today: hero photo, "Create your account", one
sentence, the form. No proof the rooms exist, no way to look before joining.

- [x] B1. Three cards under the sign-up form (form stays first; nothing moves
      it down on a phone): MM Spaces → /spaces, MM Cinema → /cinema,
      Artists → /artists. Same purple/teal tokens as the rooms. Each card:
      icon, 4-word title, one line. No new data fetching.
- [x] B2. Lead card = Spaces (the daily-habit product we just rebuilt).
- [~] B3. Karl: NO. Optional, needs Karl: a live "N rooms live now" chip on the Spaces
      card, from a cached public count. Skip if it would show 0 most days;
      an empty-room signal hurts more than no signal.
- [x] Verify: Playwright screenshots of /platform at 390px and 1280px before
      and after; form still above the fold on 390x664; Lighthouse a11y no
      regression; ISR on `/` untouched (the door is a rewrite).

## C. Privacy policy gaps (review item 3), Karl's lawyer decides wording
Not legal advice. `src/app/privacy/page.tsx` (86 lines, updated Jun 29 2026)
names only Stripe and Resend. Missing, from what the code actually uses:
- [ ] C1. Service providers: Supabase (database/auth/storage), Vercel
      (hosting), LiveKit (live audio/video in rooms), PubNub (presence),
      Cloudflare, Google and Apple sign-in.
- [ ] C2. Recording: Melori Mirror DOES record live video
      (`/api/mirror/recording/start`, MirrorRecordingControls) for the
      for-you feed. Policy must say what is recorded, when (host-started),
      who can see it, and how to delete it. Spaces/Cinema rooms: confirm no
      LiveKit egress is used, then say so. Room chat is stored until deleted.
- [ ] C3. Retention: how long accounts, chat, reports and logs are kept.
- [ ] C4. Minimum age 16+ (Karl, 2 Oct), and a CCPA/state-rights line.
- [ ] I draft the text as a PR; Karl (or a lawyer) approves the wording. I
      do not ship policy text unreviewed.

## C0. Must-fix BEFORE the policy can be honest (audit, 2 Oct)
The current /privacy promises export (none exists), "purges everything" on
delete (wrong table names, FK failures, storage left behind), and a "cart"
(none). It names Stripe + Resend only. The code also does things no policy
should have to admit. Fix first, then write the policy for the fixed state.

Karl (2 Oct): "I need people to sign in otherwise listeners and speakers
alike are not safe. There is no more superfan accounts... Sign in to
participate."

- [ ] C0-1. Sign-in wall for the API (this branch, feat/signin-wall-api).
      The proxy never gates /api, so these GETs hand member data to anyone
      with curl: mirror/live, social/faces (who is live), profiles/feed
      (member directory + online list), social/profile/[username],
      social/profile/tabs (city, birthday, unmoderated photos),
      social/reshares, mirror/feed, social/videos (`select *`),
      videos/[id]/comments, photos/[id]/comments, spaces/[id]/comments,
      spaces/[id]/reactions, community/comments, spaces/[id]/playback.
      Each GET → requireAuth (401 signed out); each caller → authFetch.
      Public /artists/[slug]: remove the "Top fans" SuperfanButton and the
      public /api/artists/[slug]/superfans route (fans' names, sometimes real
      full_name, + listening history). /api/profiles/[id]/gallery stays
      public ONLY for a published artist's own profile.
      Test: a script that calls every listed handler with no token → 401.
- [ ] C0-2. Mirror recording (decision pending): sign-in alone does NOT fix
      this. A signed-in guest is still recorded without notice, and files
      sit in a PUBLIC bucket even after "Not now". Illinois: all-party
      consent. Recommend: banner for everyone + notice on join, private
      bucket until posted, "Not now" deletes, clean up orphans.
- [ ] C0-3. Connect (dating) 18+ gate (decision pending): sign-in alone
      does not stop a 15-year-old with an account. Plus 16+ attestation at
      signup (Karl's minimum age).
- [ ] C0-4. Account deletion fixes + data export (or drop the promise).
- [ ] C0-5. Terms "nothing to buy" vs gift coins / Apple IAP; remove the
      "women-only rooms" claim until it exists.

## Order and size
A1+A2 (~half day), B1+B2 (~half day), C draft (~1 hr). A3 and B3 only on
Karl's yes. One branch per section, one PR each, full `npm run test:unit`
+ tsc + the e2e above before each PR. Migrations: none.

## Karl's answers (2 Oct)
1. B3 live-rooms chip: no.
2. C4 minimum age: 16.

## A review (2 Oct, branch feat/signed-out-teasers)
- `/listen` public teaser (FeatureTeaser, copy only, no audio/member data);
  proxy TEASER_FOR: `/music*` → `/listen`, `/social/messages*` →
  `/platform?reason=chat`; door shows "Sign in to see your messages." from
  `src/lib/doorReason.ts` (allowlisted keys only; `<b>`, `__proto__`,
  `toString` ignored).
- A3 skipped: the proxy is an allowlist on purpose. Letting unknown paths fall
  through to a 404 needs a list of real routes, and any route missing from it
  would render UNGATED for strangers. A drift test would catch it, but trading
  a fail-closed security property for a nicer 404 is the wrong trade.
- Found by screenshot: FeatureTeaser's closing box said "People go on camera
  and on microphone here" on every page incl. Radio. Now a `closing` prop
  (room wording stays the default); Music and Radio pass their own.
- Also fixed: all four room teasers said signup needs "a mobile number" —
  dropped 10 Sep (email + password only).
- Superseded assertion: signup-wall test listed /music and /social/messages as
  "no teaser — meets the door"; both now have destinations (reason in test).
- Verified: signup-wall 89/89, full `npm run test:unit` green, tsc clean,
  e2e/signed-out-teasers.spec.ts 4/4 (390x664, incl. a real tab-bar Chat tap),
  phone screenshots checked by eye. ESLint can't run in this checkout
  (pre-existing config-format error), not introduced here.

## B review (2 Oct, branch feat/door-cards, stacked on #401)
- "Inside Melori" under the form on /platform: MM Spaces (first), MM Cinema,
  The artists. Absolute APP_ORIGIN links like the rest of the door (it is
  also served on melori.org). All three targets are existing public pages;
  no data fetching, no member data. No live-room count (Karl: no).
- Form position unchanged: cards render after "Forgot your password?".
- Verified: tsc clean, full `npm run test:unit` green, e2e
  signed-out-teasers 5/5 (new test: 3 cards, Spaces first, hrefs, cards
  below the signup button), before/after screenshots at 390 and 1280.
- Lighthouse not run (no Chrome DevTools audit in this sandbox); the cards
  are plain links with headings and aria-hidden icons.

---

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
