#!/usr/bin/env bash
#
# Configure the generated iOS project: OAuth callback URL scheme + the media
# capture usage descriptions WKWebView requires before it will expose
# navigator.mediaDevices.
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

# WKWebView gates getUserMedia on these Info.plist keys. If they are absent,
# WebKit does not merely deny the permission — it removes `navigator.mediaDevices`
# from the page entirely, so MM Faces / MM Spaces fail with
#   "undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')"
# even though the exact same page works in mobile Safari, where Safari supplies
# its own descriptions. Purely a native-container gate: no web change can fix it.
# The strings are shown verbatim in the iOS permission alert and are reviewed by
# App Review, so they must name a concrete user-facing feature.
CAMERA_USAGE="Melori uses your camera so you can go live and appear on video in MM Faces and MM Spaces."
MIC_USAGE="Melori uses your microphone so you can talk and perform live in MM Faces and MM Spaces."
PHOTO_ADD_USAGE="Melori saves recordings and photos you capture in the app to your photo library."

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
        "CFBundleURLName": scheme,
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

echo "==> Registering camera/microphone usage descriptions in $INFO_PLIST"

python3 - "$INFO_PLIST" "$CAMERA_USAGE" "$MIC_USAGE" "$PHOTO_ADD_USAGE" <<'PY'
import plistlib
import sys

path, camera, mic, photo_add = sys.argv[1:5]

with open(path, "rb") as fh:
    plist = plistlib.load(fh)

wanted = {
    "NSCameraUsageDescription": camera,
    "NSMicrophoneUsageDescription": mic,
    "NSPhotoLibraryAddUsageDescription": photo_add,
}

# Overwrite rather than setdefault: a stale or placeholder string is an App
# Review rejection, and the copy above is the reviewed wording.
changed = [key for key, value in wanted.items() if plist.get(key) != value]
plist.update(wanted)

with open(path, "wb") as fh:
    plistlib.dump(plist, fh)

print(f"    {len(changed)} key(s) written, {len(wanted)} total")
PY

python3 - "$INFO_PLIST" <<'PY'
import plistlib
import sys

required = (
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
)

with open(sys.argv[1], "rb") as fh:
    plist = plistlib.load(fh)

missing = [k for k in required if not str(plist.get(k, "")).strip()]
if missing:
    raise SystemExit(
        "error: Info.plist is missing " + ", ".join(missing) + ".\n"
        "       WKWebView hides navigator.mediaDevices without these, so live\n"
        "       streaming in MM Faces / MM Spaces would ship broken."
    )
for key in required:
    print(f"    verified {key}")
PY

echo "iOS project configured: OAuth callback scheme + media capture usage descriptions registered."
