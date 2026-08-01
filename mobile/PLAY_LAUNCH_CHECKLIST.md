# Melori Music — Google Play launch checklist

The single operational doc for getting `org.melorimusic.app` from this repo to
a production listing. Sequenced. Everything is marked with who does it:

- **🤖 CI** — automated. Lives in this repo; nothing to do by hand.
- **👤 Karl** — must be done by a human in Google's UI, or involves a secret
  that must never be committed.

Build mechanics (JDK, SDK, `cap add`, keystore wiring) are in
[`BUILD_ANDROID.md`](BUILD_ANDROID.md). This file is about the *release*.

---

## ⏳ The critical path: 12 testers, 14 continuous days

**Start this the day you have any signed build. Everything else can be done in
parallel; this cannot be compressed.**

The Play account is a **Personal** account created after 13 November 2023, so
before you may even *apply* for production access you must run a closed test
with **at least 12 testers opted in continuously for the last 14 days**
([Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)).

- 12 **opted-in** testers, not 12 invitations sent. Unique Google accounts that
  clicked the opt-in link and installed on a real device.
- Emulators, bots and duplicate accounts do not count.
- The 14 days must be **continuous**. One tester opting out on day 9 damages
  the clock.
- Google also reviews whether testers actually *used* the app
  ([community guide](https://support.google.com/googleplay/android-developer/community-guide/255621488/everything-about-the-12-testers-requirement?hl=en)).

Recruit 15–18 addresses to absorb dropouts. The only prerequisite is a build on
a closed track — not the listing, not the content rating, not verification of
anything beyond what "create app" needs.

Realistic floor from first closed-test upload to live: **14 days + production
access review**.

---

## 1. Developer account — 👤 Karl

Nothing here can be automated; all of it gates "Create app".

- [ ] 👤 Android device verification (~5 min, on your phone)
- [ ] 👤 Phone number verification (instant)
- [ ] 👤 Identity documents — allow **1–3 days** for review
- [ ] 👤 Payments profile — required because the app facilitates purchases
      ([Help](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en))

Account: **MeloriMusic** (Personal, ID 7055310524218121229).

---

## 2. Upload keystore and CI secrets — 👤 Karl

The repo never contains a keystore, a password or a service-account JSON, and
must not start. `configure-android.sh` only wires up the *lookup*.

- [ ] 👤 Generate the upload keystore on your own machine:

      keytool -genkeypair -v \
        -keystore ~/melori-upload-key.jks \
        -alias melori-upload \
        -keyalg RSA -keysize 4096 \
        -validity 10000

- [ ] 👤 **Back the `.jks` up somewhere permanent** (password manager, encrypted
      drive). With Play App Signing a lost upload key is recoverable through
      Google support, but it is a multi-day detour.
- [ ] 👤 Add four repository secrets under **Settings → Secrets and variables →
      Actions**:

      | Secret | Value |
      |---|---|
      | `MELORI_KEYSTORE_BASE64` | `base64 -i ~/melori-upload-key.jks` |
      | `MELORI_KEYSTORE_PASSWORD` | keystore password |
      | `MELORI_KEY_ALIAS` | `melori-upload` |
      | `MELORI_KEY_PASSWORD` | key password |

- [ ] 👤 Enrol in **Play App Signing** at the first release. Mandatory for new
      apps ([Help](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)).
- [ ] 👤 After the first upload, deploy Play's generated
      `assetlinks.json` to `https://melorimusic.org/.well-known/assetlinks.json`
      so the `autoVerify` App Links filter actually verifies. Until then deep
      links open in the browser — inert, not broken.

---

## 3. Build and assets — 🤖 CI

Already automated. Listed so you know not to redo it by hand.

- [x] 🤖 Capacitor 8 / `compileSdk` + `targetSdk` 36, `minSdk` 24 — required for
      new submissions from **31 August 2026**
      ([Help](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en))
- [x] 🤖 Signed `.aab` (not `.apk`) from `.github/workflows/android-build.yml`
- [x] 🤖 Launcher icons at every density, adaptive foreground keyed by region
      with a build-failing assertion that it has no holes
- [x] 🤖 Store icon `resources/play-store-icon-512.png` — 512×512, 32-bit
- [x] 🤖 Feature graphic `resources/play-feature-graphic-1024x500.png` —
      **required**; Play will not publish a listing without one
- [x] 🤖 Phone screenshots `resources/play-screenshots/` —
      `npm run screenshots:play`
- [x] 🤖 Listing copy under `fastlane/metadata/android/en-US/`, character
      limits enforced by `scripts/check-play-metadata.py` on every PR

To cut a build: **Actions → Android Build & Upload (Play) → Run workflow**,
set `version_name`, `version_code` and `track`. The `.aab` is always uploaded
as a workflow artifact, whether or not the Play upload runs.

---

## 4. Play Console: create the app — 👤 Karl

Unlocks only after §1.

- [ ] 👤 Create app: name **Melori Music**, language English (US), type **App**,
      **Free**, package `org.melorimusic.app`
- [ ] 👤 Add `PLAY_SERVICE_ACCOUNT_JSON` as a repository secret so CI can push
      builds and the listing. Create the service account under **Setup → API
      access**, grant it *Release manager*
      ([Help](https://support.google.com/googleplay/android-developer/answer/9955595?hl=en)).
      Until this exists the publish steps in the workflow are a no-op by design.
- [ ] 👤 **App access** — MM Social, the Artist Studio and purchases sit behind
      login, so reviewers need working demo credentials. Create a dedicated
      reviewer account with a Superfan membership and paste it here.
- [ ] 👤 Store settings: category **Music & Audio**, tags *Music streaming ·
      Music discovery · Independent artists · Audio · Community*
- [ ] 👤 Contact details:

      | Field | Value |
      |---|---|
      | Website | `https://melorimusic.org` |
      | Email | `karlrayphotography@gmail.com` |
      | Privacy policy | `https://melorimusic.org/privacy` |

      Use `/privacy`, not `privacy.html` — the latter 404s and an older listing
      draft pointed at it.

Once the service account secret exists, the listing text and graphics are
pushed from this repo by `fastlane supply` rather than retyped.

---

## 5. App content declarations — 👤 Karl

Play's checklist. Answer truthfully; a mismatch found later is an enforcement
action, and a Teen rating costs a music app nothing.

- [ ] 👤 Privacy policy → `https://melorimusic.org/privacy`
- [ ] 👤 Ads → **No**
- [ ] 👤 Content rating (IARC questionnaire) → expect **Teen**. Users can
      interact, share user-generated content, and share personal info through
      messaging — all three are true of MM Social and all three must be
      declared.
- [ ] 👤 Target audience → **13+**. Do not tick any under-13 bracket.
- [ ] 👤 News app → No · COVID-19 tracing → No · Government app → No ·
      Health app → No
- [ ] 👤 **Financial features → Yes.** The app facilitates payments; declare
      Stripe-based commerce.
- [ ] 👤 Advertising ID → declare only if an SDK actually reads it. Since the
      **10 April 2025** policy update, Android ID counts as a device identifier
      under *Device or other IDs* if any SDK reads it — check the analytics
      stack before answering.
- [ ] 👤 Data safety → the matrix below

### Data safety matrix

Derived from the real stack: Supabase (auth/db/storage), Stripe (payments),
LiveKit (live audio/video), Resend (transactional email), PubNub (presence).
[Form guide](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

| Play data type | Collected | Shared | Purpose | Linked to user |
|---|---|---|---|---|
| Name | Yes | No | Account, profile | Yes |
| Email address | Yes | Yes (Resend) | Account, transactional email | Yes |
| User IDs | Yes | No | Account | Yes |
| Purchase history | Yes | Yes (Stripe) | Commerce, memberships | Yes |
| Payment info | Yes | Yes (Stripe) | Processing — card numbers never stored | Yes |
| Photos and videos | Yes | No | Profile media, MM Social UGC | Yes |
| Voice or sound recordings | Yes | No | Live audio spaces | Yes, in-session |
| Music files | Yes | No | Artist uploads | Yes |
| In-app messages | Yes | No | MM Social messaging | Yes |
| App interactions | Yes | No | Analytics, Superfan stats | Yes |
| Crash logs / diagnostics | Yes | No | Stability | No |

Security practices to declare:

- Data is encrypted in transit (TLS/HSTS) — **Yes**
- Users can request data deletion → `https://melorimusic.org/account/delete` — **Yes**
- Committed to the Play Families Policy — **N/A**, not child-directed
- Independent security review — **No**

### Permissions justification

The manifest declares `RECORD_AUDIO`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`,
`BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK`. Mic and camera are for LiveKit live audio
and video in MM Social; the foreground services are for background music
playback and its notification. If a feature is ever dropped, remove the
permission from `scripts/configure-android.sh` rather than leaving it declared.

---

## 6. Closed testing — 👤 Karl (build by 🤖 CI)

- [ ] 🤖 Run the workflow with `track: internal` to confirm the pipeline end to
      end, or go straight to a closed track
- [ ] 👤 Create a **Closed testing** track and an email tester list
- [ ] 👤 Recruit 15–18 testers. The artists on the platform — Karl Ray, KAIEL R,
      Gloria Joy Rivers, Gbenga Yakubu — and their circles are the natural pool
- [ ] 👤 Share the opt-in link; confirm **≥12 have opted in and installed**
- [ ] 👤 Record the date the 12th tester opted in — day 0 of the 14
- [ ] 👤 Keep them engaged for 14 continuous days. Watch for opt-outs
- [ ] 👤 Ship at least one update during the window so the testing story is real

---

## 7. Production — 👤 Karl

- [ ] 👤 Apply for production access (unlocks only after §6 completes)
- [ ] 👤 Wait out Google's review — days to weeks for a new account
- [ ] 👤 Promote the build to **Production**, or run the workflow with
      `track: production`
- [ ] 👤 Set the rollout percentage and publish

---

## Never in this repo

No keystore, no keystore password, no `key.properties`, no service-account
JSON, no tester email list. `android/` is git-ignored and regenerated on every
sync — anything that must survive belongs in `scripts/configure-android.sh`.
