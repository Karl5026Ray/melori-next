# Building & Uploading the Melori Music iOS App

This wraps the live **melorimusic.org** site in a native iOS app using [Capacitor](https://capacitorjs.com/). The app loads your live Vercel site in a native WebView, so **content updates ship automatically** — you only rebuild the app when you change native config (icon, name, permissions).

You do this on your **Mac**. No Swift/iOS coding required. Budget ~45 min the first time (mostly the Xcode download).

---

## What you need (one-time)

1. **Xcode** — free from the Mac App Store. Search "Xcode", install (~7 GB, slow — start this first).
2. **Node.js** — if `node -v` in Terminal fails, install from [nodejs.org](https://nodejs.org) (LTS).
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
npx cap add ios
```
This creates the `ios/` folder (a real Xcode project). It's git-ignored on purpose — it's generated, not committed.

### 4. Sync config into the native project
```bash
npx cap sync ios
```

### 5. Open in Xcode
```bash
npx cap open ios
```
Xcode launches with the Melori Music project.

### 6. Set the app icon (in Xcode)
- In the left sidebar, expand **App → App → Assets** (or `Assets.xcassets`).
- Click **AppIcon**.
- Drag `mobile/resources/icon-1024.png` onto the **1024pt "App Store"** slot (single-size icon works on modern Xcode; it auto-generates the rest).
  - If your Xcode shows multiple slots, install `npm i -g cordova-res` then run `cordova-res ios --skip-config --copy` from the `mobile/` folder to auto-generate all sizes.

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
- **Android:** the same wrapper supports Android — run `npx cap add android` and build in Android Studio when you tackle Google Play.

---

## If you get stuck
Tell me the exact Xcode error or the step number, and I'll walk you through it. I can also add the iOS purchase-button toggle or set up a GitHub Actions macOS workflow to automate future builds.
