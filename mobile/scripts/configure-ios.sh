#!/usr/bin/env bash
#
# Register the OAuth callback URL scheme in the generated iOS project.
#
# WHY THIS EXISTS
# ---------------
# Sign-in cannot run inside the WebView — Google answers `disallowed_useragent`
# — so it runs in an SFSafariViewController and the provider redirects to
# `org.melorimusic.app://auth/callback`. iOS only routes that back into the app
# if the scheme is declared in Info.plist's CFBundleURLTypes. Without this the
# redirect dead-ends in the browser sheet and the app stays signed out.
#
# `npx cap add ios` / `npx cap sync ios` regenerate ios/App from the Capacitor
# template and ios/ is git-ignored, so — exactly like install-ios-icon.sh and
# configure-android.sh — the declaration has to be re-applied after every sync.
# scripts/postsync.sh chains this.
#
# Uses python3/plistlib rather than `plutil` so the edit is idempotent and
# readable, and so it can be dry-run on Linux against a copied plist.
#
#   bash scripts/configure-ios.sh
#
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFO_PLIST="${MELORI_IOS_INFO_PLIST:-$MOBILE_DIR/ios/App/App/Info.plist}"

# Must match NATIVE_URL_SCHEME in src/lib/nativeAuth.ts and the appId in
# capacitor.config.json.
AUTH_SCHEME="org.melorimusic.app"

if [ ! -f "$INFO_PLIST" ]; then
  echo "error: $INFO_PLIST not found. Run 'npx cap add ios && npx cap sync ios' first." >&2
  exit 1
fi

echo "==> Registering $AUTH_SCHEME:// in $INFO_PLIST"

python3 - "$INFO_PLIST" "$AUTH_SCHEME" <<'PY'
import plistlib
import sys

path, scheme = sys.argv[1], sys.argv[2]

with open(path, "rb") as fh:
    plist = plistlib.load(fh)

url_types = plist.setdefault("CFBundleURLTypes", [])
if any(scheme in entry.get("CFBundleURLSchemes", []) for entry in url_types):
    print("    already registered, skipping")
    sys.exit(0)

url_types.append(
    {
        "CFBundleURLName": f"{scheme}.auth",
        # Viewer role: the app receives these URLs, it does not serve them.
        "CFBundleTypeRole": "Viewer",
        "CFBundleURLSchemes": [scheme],
    }
)

with open(path, "wb") as fh:
    plistlib.dump(plist, fh)
print("    added CFBundleURLTypes entry")
PY

python3 - "$INFO_PLIST" "$AUTH_SCHEME" <<'PY'
import plistlib
import sys

path, scheme = sys.argv[1], sys.argv[2]
with open(path, "rb") as fh:
    plist = plistlib.load(fh)

registered = [
    s
    for entry in plist.get("CFBundleURLTypes", [])
    for s in entry.get("CFBundleURLSchemes", [])
]
if scheme not in registered:
    raise SystemExit(f"error: {scheme} missing from CFBundleURLTypes after patching")
print(f"    verified URL schemes: {', '.join(registered)}")
PY

echo "iOS project configured: OAuth callback scheme registered."
