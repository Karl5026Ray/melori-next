#!/usr/bin/env bash
#
# Install the Melori app icon into the generated Capacitor iOS project.
#
# WHY THIS EXISTS
# ---------------
# `npx cap add ios` / `npx cap sync ios` regenerate ios/App from the Capacitor
# template, which ships a placeholder AppIcon. Because the native project is
# git-ignored (generated per-build), every CI run started from that placeholder
# and shipped it to App Store Connect — which is how the wrong icon reached the
# live listing. This script is the missing step: it renders every required
# AppIcon slot from mobile/resources/icon-1024.png and writes a matching
# Contents.json, so the correct mark is baked into the archive every time.
#
# Requires macOS (uses the built-in `sips`). Run from anywhere:
#   mobile/scripts/install-ios-icon.sh
#
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="$MOBILE_DIR/resources/icon-1024.png"
ICON_SET="$MOBILE_DIR/ios/App/App/Assets.xcassets/AppIcon.appiconset"

if ! command -v sips >/dev/null 2>&1; then
  echo "error: 'sips' not found — this script must run on macOS." >&2
  exit 1
fi

if [ ! -f "$SOURCE_ICON" ]; then
  echo "error: source icon missing at $SOURCE_ICON" >&2
  exit 1
fi

if [ ! -d "$ICON_SET" ]; then
  echo "error: $ICON_SET not found. Run 'npx cap add ios && npx cap sync ios' first." >&2
  exit 1
fi

# --- Validate the source against App Store requirements -----------------------
# Apple rejects marketing icons that are not exactly 1024x1024 or that contain
# an alpha channel / transparency.
width="$(sips -g pixelWidth "$SOURCE_ICON" | awk '/pixelWidth/{print $2}')"
height="$(sips -g pixelHeight "$SOURCE_ICON" | awk '/pixelHeight/{print $2}')"
has_alpha="$(sips -g hasAlpha "$SOURCE_ICON" | awk '/hasAlpha/{print $2}')"

if [ "$width" != "1024" ] || [ "$height" != "1024" ]; then
  echo "error: source icon must be 1024x1024 (found ${width}x${height})." >&2
  exit 1
fi
if [ "$has_alpha" = "yes" ]; then
  echo "error: source icon has an alpha channel. App Store icons must be opaque." >&2
  exit 1
fi

echo "Installing app icon from $SOURCE_ICON"
echo "  -> $ICON_SET"

# Clear the template placeholders so no stale slot survives.
rm -f "$ICON_SET"/*.png

emit() { # emit <pixel-size> <filename>
  sips -s format png -z "$1" "$1" "$SOURCE_ICON" --out "$ICON_SET/$2" >/dev/null
}

# iPhone
emit 40   AppIcon-20@2x.png
emit 60   AppIcon-20@3x.png
emit 58   AppIcon-29@2x.png
emit 87   AppIcon-29@3x.png
emit 80   AppIcon-40@2x.png
emit 120  AppIcon-40@3x.png
emit 120  AppIcon-60@2x.png
emit 180  AppIcon-60@3x.png
# iPad
emit 20   AppIcon-20.png
emit 29   AppIcon-29.png
emit 40   AppIcon-40.png
emit 76   AppIcon-76.png
emit 152  AppIcon-76@2x.png
emit 167  AppIcon-83.5@2x.png
# App Store marketing
emit 1024 AppIcon-1024.png

cat > "$ICON_SET/Contents.json" <<'JSON'
{
  "images" : [
    { "idiom" : "iphone", "size" : "20x20", "scale" : "2x", "filename" : "AppIcon-20@2x.png" },
    { "idiom" : "iphone", "size" : "20x20", "scale" : "3x", "filename" : "AppIcon-20@3x.png" },
    { "idiom" : "iphone", "size" : "29x29", "scale" : "2x", "filename" : "AppIcon-29@2x.png" },
    { "idiom" : "iphone", "size" : "29x29", "scale" : "3x", "filename" : "AppIcon-29@3x.png" },
    { "idiom" : "iphone", "size" : "40x40", "scale" : "2x", "filename" : "AppIcon-40@2x.png" },
    { "idiom" : "iphone", "size" : "40x40", "scale" : "3x", "filename" : "AppIcon-40@3x.png" },
    { "idiom" : "iphone", "size" : "60x60", "scale" : "2x", "filename" : "AppIcon-60@2x.png" },
    { "idiom" : "iphone", "size" : "60x60", "scale" : "3x", "filename" : "AppIcon-60@3x.png" },
    { "idiom" : "ipad", "size" : "20x20", "scale" : "1x", "filename" : "AppIcon-20.png" },
    { "idiom" : "ipad", "size" : "20x20", "scale" : "2x", "filename" : "AppIcon-20@2x.png" },
    { "idiom" : "ipad", "size" : "29x29", "scale" : "1x", "filename" : "AppIcon-29.png" },
    { "idiom" : "ipad", "size" : "29x29", "scale" : "2x", "filename" : "AppIcon-29@2x.png" },
    { "idiom" : "ipad", "size" : "40x40", "scale" : "1x", "filename" : "AppIcon-40.png" },
    { "idiom" : "ipad", "size" : "40x40", "scale" : "2x", "filename" : "AppIcon-40@2x.png" },
    { "idiom" : "ipad", "size" : "76x76", "scale" : "1x", "filename" : "AppIcon-76.png" },
    { "idiom" : "ipad", "size" : "76x76", "scale" : "2x", "filename" : "AppIcon-76@2x.png" },
    { "idiom" : "ipad", "size" : "83.5x83.5", "scale" : "2x", "filename" : "AppIcon-83.5@2x.png" },
    { "idiom" : "ios-marketing", "size" : "1024x1024", "scale" : "1x", "filename" : "AppIcon-1024.png" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON

# --- Verify every declared slot exists and is opaque --------------------------
missing=0
for f in "$ICON_SET"/*.png; do
  if [ "$(sips -g hasAlpha "$f" | awk '/hasAlpha/{print $2}')" = "yes" ]; then
    echo "error: generated $f has an alpha channel." >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

echo "App icon installed: $(ls -1 "$ICON_SET"/*.png | wc -l | tr -d ' ') PNG slots + Contents.json"
