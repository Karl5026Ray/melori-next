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

# Hard guard on the artwork itself: present, a real PNG, exactly 1024x1024, and
# matching the committed checksum. Shared with configure-android.sh so a
# placeholder fails both platforms identically instead of slipping through one.
# shellcheck source=lib/icon-source.sh
. "$MOBILE_DIR/scripts/lib/icon-source.sh"
melori_assert_icon_source "$SOURCE_ICON" || exit 1

if [ ! -d "$ICON_SET" ]; then
  echo "error: $ICON_SET not found. Run 'npx cap add ios && npx cap sync ios' first." >&2
  exit 1
fi

# --- Flatten any alpha out of the source before rendering ---------------------
# Apple rejects App Store icons containing an alpha channel, and every slot is
# rendered from this one file, so alpha is removed here rather than being
# passed through and caught slot-by-slot at the end. The shared source is a PNG
# and PNGs can carry alpha; today's is opaque RGB, so this is normally a no-op.
RENDER_SOURCE="$SOURCE_ICON"
if [ "$(sips -g hasAlpha "$SOURCE_ICON" | awk '/hasAlpha/{print $2}')" = "yes" ]; then
  if command -v magick >/dev/null 2>&1; then
    IM=magick
  elif command -v convert >/dev/null 2>&1; then
    IM=convert
  else
    echo "error: $SOURCE_ICON has an alpha channel and ImageMagick is not" \
         "installed to flatten it. 'sips' cannot remove alpha. Install" \
         "ImageMagick ('brew install imagemagick') or re-export the source" \
         "as opaque RGB." >&2
    exit 1
  fi
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  RENDER_SOURCE="$TMP_DIR/icon-opaque.png"
  echo "note: source has an alpha channel; flattening onto opaque black for iOS"
  "$IM" "$SOURCE_ICON" -background black -alpha remove -alpha off \
    -strip "PNG24:$RENDER_SOURCE"
fi

echo "Installing app icon from $SOURCE_ICON"
echo "  -> $ICON_SET"

# Clear the template placeholders so no stale slot survives.
rm -f "$ICON_SET"/*.png

emit() { # emit <pixel-size> <filename>
  sips -s format png -z "$1" "$1" "$RENDER_SOURCE" --out "$ICON_SET/$2" >/dev/null
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
failures=0

# Every filename Contents.json references must exist on disk. A missing
# AppIcon-1024.png is precisely the bug that shipped a placeholder to App Store
# Connect, so it is checked by name rather than inferred from a glob.
for f in $(awk -F'"' '/"filename"/{print $(NF-1)}' "$ICON_SET/Contents.json" | sort -u); do
  if [ ! -s "$ICON_SET/$f" ]; then
    echo "error: Contents.json references $f but it is missing or empty." >&2
    failures=1
  fi
done

for f in "$ICON_SET"/*.png; do
  if [ "$(sips -g hasAlpha "$f" | awk '/hasAlpha/{print $2}')" = "yes" ]; then
    echo "error: generated $f has an alpha channel." >&2
    failures=1
  fi
done

# The App Store marketing slot gets its own explicit assertion: 1024x1024 and
# fully opaque, the two things Apple rejects the upload for.
marketing="$ICON_SET/AppIcon-1024.png"
if [ ! -s "$marketing" ]; then
  echo "error: $marketing is missing or empty — this is the App Store marketing icon." >&2
  failures=1
else
  m_width="$(sips -g pixelWidth "$marketing" | awk '/pixelWidth/{print $2}')"
  m_height="$(sips -g pixelHeight "$marketing" | awk '/pixelHeight/{print $2}')"
  m_alpha="$(sips -g hasAlpha "$marketing" | awk '/hasAlpha/{print $2}')"
  if [ "$m_width" != "1024" ] || [ "$m_height" != "1024" ]; then
    echo "error: AppIcon-1024.png is ${m_width}x${m_height}, expected 1024x1024." >&2
    failures=1
  fi
  if [ "$m_alpha" = "yes" ]; then
    echo "error: AppIcon-1024.png has an alpha channel; App Store icons must be opaque." >&2
    failures=1
  fi
  echo "AppIcon-1024.png: ${m_width}x${m_height}, hasAlpha=${m_alpha}"
fi

[ "$failures" -eq 0 ] || exit 1

echo "App icon installed: $(ls -1 "$ICON_SET"/*.png | wc -l | tr -d ' ') PNG slots + Contents.json"
