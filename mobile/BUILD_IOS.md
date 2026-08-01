# Building & Uploading the Melori Music iOS App

This wraps the live **melorimusic.org** site in a native iOS app using [Capacitor](https://capacitorjs.com/). The app loads your live Vercel site in a native WebView, so **content updates ship automatically** — you only rebuild the app when you change native config (icon, name, permissions).

You do this on your **Mac**. No Swift/iOS coding required. Budget ~45 min the first time (mostly the Xcode download).

---

## What you need (one-time)

1. **Xcode** — free from the Mac App Store. Search "Xcode", install (~7 GB, slow — start this first).
2. **Node.js 22 or newer** — check with `node -v`. The Capacitor 8 CLI refuses to run on Node 20. Install from [nodejs.org](https://nodejs.org) (LTS).
3. **CocoaPods** — in Terminal: `sudo gem install cocoapods` (Capacitor uses it).
4. Your **Apple ID** that owns the developer account (karlrayphotography@gmail.com), signed into Xcode.

---

## Step-by-step

Open **Terminal** (Applications → Utilities → Terminal) and run these one block at a time.

### 1. Get the code and enter the mobile wrapper
```bash
# Clone if you don't already have it locally:
git clone https://github.com/Karl5026Ray/melori-next.git
cd melori-next

# Pull the branch with the wrapper (or main, once merged):
git checkout feat/ios-capacitor-wrapper   # or: git checkout main && git pull

cd mobile
```

### 2. Install dependencies
```bash
npm install
```

### 3. Add the native iOS project
```bash
npm run add:ios     # = npx cap add ios --packagemanager CocoaPods
```
This creates the `ios/` folder (a real Xcode project). It's git-ignored on purpose — it's generated, not committed.

**Use `npm run add:ios`, not a bare `npx cap add ios`.** Capacitor 8 defaults
the iOS template to Swift Package Manager, which generates a `CapApp-SPM`
package and **no `Podfile` / `App.xcworkspace`**. Fastlane and CI build the
workspace, so a bare `cap add ios` produces a project they can't archive.

### 4. Sync config into the native project
```bash
npx cap sync ios
```
This also installs the app icon (`npm run sync` chains the post-sync steps). If
you ran `npx cap sync ios` directly, install the icon yourself:
```bash
npm run icon:ios
```

### 5. Open in Xcode
```bash
npx cap open ios
```
Xcode launches with the Melori Music project.

### 6. App icon — automatic, do not set by hand
The icon is no longer a manual Xcode drag-and-drop step. `mobile/scripts/install-ios-icon.sh`
renders every AppIcon slot (iPhone, iPad, and the 1024×1024 App Store marketing
icon) from `mobile/resources/icon-1024.png` and writes the matching `Contents.json`.

**Important:** `npx cap add ios` / `npx cap sync ios` regenerate `ios/App` from the
Capacitor template and restore its *placeholder* icon. That is why a wrong icon
shipped to the App Store previously. Always re-run the icon step after any sync:
```bash
npm run icon:ios
```
CI does this automatically (see `.github/workflows/ios-build.yml`), and Fastlane
now hard-fails the archive if `AppIcon-1024.png` is missing.

To change the icon in future, replace **only** `mobile/resources/icon-1024.png`,
then update its pin:

```bash
shasum -a 256 mobile/resources/icon-1024.png | awk '{print $1}' \
  > mobile/resources/icon-1024.png.sha256
```

It must be exactly 1024×1024 PNG with **no alpha channel / transparency**.
Before rendering anything the script checks the PNG header, the dimensions, the
file size and that checksum, and refuses to run on a mismatch — a file merely
existing at the right path is not enough, which is how the placeholder got
through last time. If a future source ever does carry alpha it is flattened to
opaque rather than passed through, and the generated `AppIcon-1024.png` is
asserted by name to be 1024×1024 and alpha-free.

Verify in Xcode before archiving: **App → App → Assets → AppIcon** should show
the Melori “M” mark in every slot, not a placeholder.

### 7. Configure signing (in Xcode)
- Select the top **App** target → **Signing & Capabilities** tab.
- **Team:** pick your Apple Developer team (Karl Ray).
- **Bundle Identifier:** confirm it says `org.melorimusic.app` (must match App Store Connect exactly).
- Check **"Automatically manage signing."** Xcode creates the certificate + provisioning profile for you.

### 8. Set version & build number
- Still on the target → **General** tab.
- **Version:** `1.0`   **Build:** `1`

### 9. Confirm encryption declaration
The wrapper already declares standard HTTPS-only encryption (exempt). If Xcode/App Store Connect asks about export compliance, answer:
- "Does your app use encryption?" → **Yes** (HTTPS)
- "Does it qualify for exemption?" → **Yes** (only standard encryption / HTTPS)

### 10. Archive and upload
- Top menu: set the run destination to **"Any iOS Device (arm64)"** (not a simulator).
- Menu: **Product → Archive.** Wait for it to build (a few minutes).
- When the Organizer window opens: click **Distribute App → App Store Connect → Upload.**
- Follow the prompts (keep defaults). Xcode uploads the build to App Store Connect.

### 11. Attach the build to your listing
- Wait ~5–15 min for Apple to finish "Processing" the build (you'll get an email).
- Go to [App Store Connect → Melori Music → 1.0](https://appstoreconnect.apple.com/apps/6792791603) → **Build** section → **"+"** / **Select a build** → choose Build 1.
- Answer the export-compliance prompt (Yes HTTPS / exempt) if shown.

### 12. Submit
- Click **Add for Review → Submit.** Everything else on the listing is already filled in.

---

## Notes & gotchas

- **App Store review risk (thin-wrapper rule):** Apple sometimes rejects apps that are "just a website." Melori is a rich PWA with streaming, accounts, community, live audio, and purchases, which satisfies the "app-like" bar, but if reviewers push back, the reply is: it's a full-featured streaming/community platform, not a repackaged marketing page. Having native status-bar handling + offline fallback (both included here) helps.
- **In-app purchases:** the app loads your Stripe/web checkout. Under Apple's rules, digital-goods purchases inside the app normally require Apple IAP. Safest v1 posture: the iOS app is stream + discover + community; if a reviewer flags the buy buttons, either (a) apply for the **Reader App** entitlement, or (b) hide purchase buttons on iOS via a user-agent check. Ask me and I'll add the iOS-detection toggle to the web app.
- **Push notifications, deep links:** not included in v1. Can be added later.
- **Minimum iOS version:** Capacitor 8 raises the deployment target to **iOS 15.0** (Capacitor 6 was 13.0). Devices on iOS 13/14 can no longer install new builds.
- **Android:** now first-class — see **BUILD_ANDROID.md** and `.github/workflows/android-build.yml`.

---

## If you get stuck
Tell me the exact Xcode error or the step number, and I'll walk you through it. I can also add the iOS purchase-button toggle or set up a GitHub Actions macOS workflow to automate future builds.
