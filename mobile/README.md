# mobile/ — Melori Music native app wrapper

Capacitor wrapper that packages the live **melorimusic.org** PWA into native
**iOS and Android** apps for the App Store and Google Play.

Runs on **Capacitor 8** (`8.5.0`). Android targets **API 36**, which Play
requires for new apps from 2026-08-31; Capacitor pins the target SDK to its
major version, so API 36 and Capacitor 8 come as a pair. Building needs
**Node 22+**, plus **JDK 21** for Android and Xcode for iOS.

## Architecture: remote-URL wrapper

Melori is a full server-rendered Next.js app (SSR, API routes, Supabase auth,
Stripe, LiveKit, VPS rewrites) — it can't be exported to static files. So the
native shell loads the **live site** in a WebView via `server.url` in
`capacitor.config.json`. Benefits:

- Content/features update automatically from Vercel — no app rebuild for changes.
- One source of truth (the web app); no code duplication.
- Rebuild the native app only for icon/name/permission/version changes.

## Files

| File | Purpose |
|---|---|
| `capacitor.config.json` | App ID `org.melorimusic.app`, name, `server.url` → live site, allowed navigation hosts, dark `#111111` background |
| `www/index.html` | Branded offline/splash fallback (shown only if the WebView can't reach the site) |
| `resources/icon-1024.png` | Icon source for **both** platforms (1024², no alpha) |
| `resources/logo-source-1200.png` | Original logo, for regenerating assets |
| `scripts/install-ios-icon.sh` | Renders every iOS AppIcon slot after `cap sync` |
| `scripts/configure-android.sh` | Applies SDK 36, icons, permissions, App Links + signing after `cap sync` |
| `scripts/postsync.sh` | Runs whichever of the two apply; chained by `npm run sync` |
| `BUILD_IOS.md` | Full step-by-step Mac build + upload guide |
| `BUILD_ANDROID.md` | Keystore, local build, CI, and Play submission guide |
| `package.json` | Capacitor deps + helper scripts |

The generated `ios/` and `android/` native projects are **git-ignored** — they're
created locally with `npx cap add …` and regenerated rather than committed.

Because they're regenerated, **anything the release needs must live in a
post-sync script**, not in the native project. `npm run sync` runs `cap sync`
followed by `scripts/postsync.sh`, which applies the iOS icon step and the
Android configure step, skipping whichever platform folder is absent. This is
why a placeholder icon once shipped to the App Store — the generated project was
taken as-is.

## Quick start — iOS (Mac)

```bash
cd mobile
npm install
npm run add:ios      # cap add ios --packagemanager CocoaPods
npm run sync
npm run open:ios     # then Archive → Distribute in Xcode
```

The `--packagemanager CocoaPods` flag matters: Capacitor 8 defaults iOS to Swift
Package Manager, which produces no `App.xcworkspace` and would break the
Fastlane pipeline. See **BUILD_IOS.md**.

## Quick start — Android (any OS)

```bash
cd mobile
npm install
npm run add:android
npm run sync
cd android && ./gradlew bundleRelease \
  -PmeloriVersionName=1.0.1 -PmeloriVersionCode=1
```

Signing needs an upload keystore — see **BUILD_ANDROID.md**. Without one the
bundle still builds, unsigned.

## CI

| Workflow | Purpose |
|---|---|
| `.github/workflows/ios-build.yml` | Signed `.ipa` → TestFlight (macOS runner, Fastlane + match) |
| `.github/workflows/android-build.yml` | Signed `.aab` → artifact, optional Play internal track (Ubuntu runner) |

Both are `workflow_dispatch` only and take the version as an input.
