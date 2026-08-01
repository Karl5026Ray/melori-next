# Building & Uploading the Melori Music Android App

This wraps the live **melorimusic.org** site in a native Android app using
[Capacitor](https://capacitorjs.com/). Like the iOS build, the app loads the
live Vercel site in a native WebView, so **content updates ship automatically**
— you only rebuild when native config changes (icon, name, permissions, SDK).

Unlike iOS, you can do all of this on **Linux, Windows or macOS**, and CI can do
it end-to-end (see `.github/workflows/android-build.yml`).

---

## Why Capacitor 8

Google Play requires new apps to target **API 35** today and **API 36 from
2026-08-31**. Capacitor pins the Android target SDK to its major version and
[explicitly does not support custom target SDK
versions](https://capacitorjs.com/docs/android/setting-target-sdk):

| Capacitor | targetSdk |
|---|---|
| 8.x | 36 |
| 7.x | 35 |
| 6.x | 34 |

So shipping to Play means Capacitor 8. That is why this wrapper is on 8.5.0.

Capacitor 8 also raises `minSdkVersion` to **24** (Android 7.0). This is not
adjustable downward — `cordova-android` 14, which Capacitor 8 depends on,
declares `minSdk 24` and the manifest merger hard-fails below it.

---

## What you need (one-time)

1. **JDK 21** — `java -version` should report 21. Capacitor 8's Android library
   compiles against Java 21. (Temurin: <https://adoptium.net>.)
2. **Android Studio** (or just the Android SDK command-line tools) with
   **platform 36** and **build-tools 36.x** installed.
3. **Node.js 22 or newer.** The Capacitor 8 CLI refuses to run on Node 20.
4. An **upload keystore** — see below. Generate it once and never lose it.

---

## Step 1 — Generate the upload keystore (once, on your machine)

This file is your app's identity on Google Play. **It is not in this repo and
must never be committed.** If you lose it you must ask Google to reset your
upload key.

```bash
keytool -genkeypair -v \
  -keystore melori-upload.jks \
  -alias melori-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` prompts for a keystore password, a key password, and your name /
organisation details. Use a password manager — you need these values again for
every build.

Store the resulting `melori-upload.jks` somewhere safe and backed up (password
manager vault, encrypted drive). Do not put it in the repository.

> **Play App Signing:** Google re-signs your app with a key it holds, so the
> keystore above is your *upload* key, not the final app signing key. Enrol in
> Play App Signing when you create the app record — it is mandatory for new
> apps and means a lost upload key is recoverable.

---

## Step 2 — Local build

```bash
cd mobile
npm install
npx cap add android
npx cap sync android
npm run configure:android
```

`configure:android` is the important step. `cap add` / `cap sync` regenerate
`android/` from the Capacitor template and `android/` is git-ignored, so the
script re-applies everything the release needs:

- `variables.gradle` → `minSdkVersion 24`, `compileSdkVersion 36`, `targetSdkVersion 36`
- Launcher icons at every density (mdpi→xxxhdpi) plus the adaptive
  foreground/background, rendered from `resources/icon-1024.png` — the same
  source the iOS icon script uses
- The LiveKit / media-playback permissions (`RECORD_AUDIO`, `CAMERA`,
  `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`)
- The `autoVerify` App Links intent-filter for `https://melorimusic.org`
- The release signing config

`npm run sync` runs `cap sync` and then the iOS *and* Android post-sync steps,
skipping whichever platform folder is absent.

### Point the build at your keystore

Create `mobile/android/key.properties` (git-ignored along with the rest of
`android/`):

```properties
storeFile=/absolute/path/to/melori-upload.jks
storePassword=…
keyAlias=melori-upload
keyPassword=…
```

Or set `MELORI_KEYSTORE_PATH`, `MELORI_KEYSTORE_PASSWORD`, `MELORI_KEY_ALIAS`
and `MELORI_KEY_PASSWORD` in the environment. The Gradle config prefers
`key.properties` and falls back to the env vars.

If neither is present, `bundleRelease` still succeeds but produces an
**unsigned** bundle — useful for verifying the project builds, useless for Play.

### Produce the bundle

```bash
cd android
./gradlew bundleRelease -PmeloriVersionName=1.0.1 -PmeloriVersionCode=1
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`.

`meloriVersionName` / `meloriVersionCode` are Gradle properties rather than
values checked into the tree, matching how the iOS workflow takes
`marketing_version` and `build_number` as inputs. `versionCode` must increase
with every upload to Play.

To open the project in Android Studio instead:

```bash
npm run open:android
```

---

## Step 3 — CI build

`.github/workflows/android-build.yml` does all of the above on an Ubuntu
runner. Run it from **Actions → Android Build & Upload (Play) → Run workflow**
and supply `version_name` and `version_code`. It uploads the signed `.aab` as a
build artifact.

### Required GitHub secrets

| Secret | Value |
|---|---|
| `MELORI_KEYSTORE_BASE64` | `base64 -w0 melori-upload.jks` (macOS: `base64 -i melori-upload.jks`) |
| `MELORI_KEYSTORE_PASSWORD` | keystore password from Step 1 |
| `MELORI_KEY_ALIAS` | `melori-upload` |
| `MELORI_KEY_PASSWORD` | key password from Step 1 |

### Optional secret

| Secret | Value |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` | Play service account JSON, for automated upload |

The publish step only runs when you set the `publish_to_play` input to `yes`
**and** `PLAY_SERVICE_ACCOUNT_JSON` exists. Until the Play account is verified
and an app record for `org.melorimusic.app` is created, leave both alone — the
workflow still builds and uploads the artifact.

---

## Step 4 — Google Play submission

1. **Verify the developer account.** Google requires identity verification for
   new developer accounts before you can publish. Do this first; it can take
   several days.
2. **Create the app** in Play Console with package name `org.melorimusic.app`
   and enrol in **Play App Signing**.
3. **Upload the `.aab`.** Play only accepts Android App Bundles for new apps —
   an `.apk` is rejected. The build artifact from the workflow is already the
   right format.
4. **Closed testing.** New personal developer accounts must run a closed test
   with **at least 12 testers opted in for 14 continuous days** before applying
   for production access. Start this early — it is usually the long pole.
5. **Store listing:** icon (512×512, written to
   `android/app/src/main/play/store-icon-512.png` by the configure script),
   feature graphic, screenshots, privacy policy URL, data safety form.

---

## Notes & gotchas

- **Permissions and review.** The app requests microphone and camera for
  LiveKit rooms. Play asks you to justify these in the store listing; describe
  the live audio/video community feature. If a feature is dropped, remove the
  permission from `configure-android.sh` rather than leaving it declared.
- **App Links verification.** The `autoVerify` intent-filter only takes effect
  if `https://melorimusic.org/.well-known/assetlinks.json` is served with the
  app's SHA-256 signing fingerprint. Play Console generates that file for you
  under **Setup → App signing** once the app is uploaded; it must then be
  deployed to the site. Until then, links open in the browser as before — the
  filter is inert, not broken.
- **Thin-wrapper policy.** Play is more relaxed than Apple here, but the same
  argument applies: Melori is a full streaming/community platform, not a
  repackaged web page.
- **Purchases.** The app loads the existing Stripe/web checkout. Play's billing
  policy on digital goods mirrors Apple's; if this is flagged, the options are
  the same as on iOS (hide purchase entry points on Android via a user-agent
  check, or integrate Play Billing).
- **Never commit `android/`.** It is generated. Every change that must survive
  belongs in `scripts/configure-android.sh`.
