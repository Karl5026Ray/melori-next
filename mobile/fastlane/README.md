# Automated iOS builds via GitHub Actions

This lets GitHub build and upload your iOS app to TestFlight **without you owning
a Mac** — a macOS runner in the cloud does the Xcode work. You trigger it with a
button (or a git tag), and the build lands in App Store Connect a few minutes later.

Workflow: [`.github/workflows/ios-build.yml`](../../.github/workflows/ios-build.yml)
Fastlane lane: `mobile/fastlane/Fastfile` → `ios release`

---

## One-time setup: add 6 repository secrets

Go to **GitHub → your repo → Settings → Secrets and variables → Actions →
New repository secret** and add each of these. This is the only part that
requires you (it involves your Apple account + certificates).

### 1–3. App Store Connect API key
Create at [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api).
- Click **+**, name it "GitHub CI", role **App Manager**, Generate.
- Download the `AuthKey_XXXXXXXXXX.p8` file (you can only download it once).
- Note the **Key ID** and the **Issuer ID** shown on that page.

| Secret name | Value |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | the Key ID (e.g. `A1B2C3D4E5`) |
| `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID (a UUID) |
| `APP_STORE_CONNECT_KEY_P8` | the **entire contents** of the `.p8` file (open it in TextEdit, copy everything including the `-----BEGIN/END PRIVATE KEY-----` lines) |

### 4–5. Distribution certificate (.p12)
You need an **Apple Distribution** certificate exported as a `.p12`.

Easiest path (on any Mac, once — or ask an Apple-dev friend):
1. [developer.apple.com → Certificates](https://developer.apple.com/account/resources/certificates/list) → **+** → **Apple Distribution** → follow prompts (needs a CSR from Keychain Access → Certificate Assistant → Request a Certificate from a CA).
2. Download the cert, double-click to add to Keychain.
3. In **Keychain Access**, find the cert, right-click → **Export** → save as `.p12`, set a password.
4. base64-encode it:
   ```bash
   base64 -i dist.p12 | pbcopy   # copies to clipboard (macOS)
   ```

| Secret name | Value |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | the base64 string from the command above |
| `IOS_DIST_CERT_PASSWORD` | the password you set when exporting the `.p12` |

> No Mac at all? You can generate a distribution certificate + key with OpenSSL
> and upload the CSR in the Apple portal. Ask me and I'll give you the exact
> OpenSSL commands — it avoids needing a Mac for this step too.

### 6. Provisioning profile
1. [developer.apple.com → Profiles](https://developer.apple.com/account/resources/profiles/list) → **+** → **App Store** distribution.
2. App ID: **org.melorimusic.app** (create this App ID first under Identifiers if it doesn't exist).
3. Select your Apple Distribution certificate. Name it exactly **`Melori Music App Store`** (the Fastfile references this name).
4. Download the `.mobileprovision`, then base64-encode:
   ```bash
   base64 -i Melori_Music_App_Store.mobileprovision | pbcopy
   ```

| Secret name | Value |
|---|---|
| `IOS_PROVISIONING_PROFILE_BASE64` | the base64 string |

---

## Running a build

Once the 6 secrets are set:

1. GitHub → your repo → **Actions** tab → **"iOS Build & Upload (TestFlight)"** → **Run workflow**.
2. Enter a **build number** higher than the last one you uploaded (start at `1`).
3. Click **Run**. In ~15–25 min the build appears in
   [App Store Connect → TestFlight](https://appstoreconnect.apple.com/apps/6792791603/testflight/ios).

Or push a tag: `git tag ios-v1.0.0 && git push origin ios-v1.0.0`.

## After the build lands
- Test it via TestFlight (optional but recommended).
- To ship: App Store Connect → the **1.0** version → **Build** section → select the
  build → **Add for Review → Submit**. All other listing fields are already complete.

## Notes
- The lane uploads to **TestFlight only** (`skip_submission: true`) — it never
  auto-submits to App Store review, so you stay in control of the final submit.
- Bundle ID everywhere is `org.melorimusic.app`; the profile must be named
  `Melori Music App Store` to match the Fastfile.
- Since the app is a remote-URL wrapper, you rarely need to rebuild — only for
  icon/name/permission/version changes.
