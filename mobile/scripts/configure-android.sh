#!/usr/bin/env bash
#
# Configure the generated Capacitor Android project for a Google Play release.
#
# WHY THIS EXISTS
# ---------------
# `npx cap add android` / `npx cap sync android` regenerate android/ from the
# Capacitor template, and android/ is git-ignored (see mobile/.gitignore), so
# anything the Play build needs has to be re-applied after every sync. This is
# the Android counterpart of scripts/install-ios-icon.sh, which exists for the
# same reason (a placeholder icon once shipped to the App Store because the
# regenerated project was taken as-is).
#
# It applies, idempotently:
#   1. variables.gradle SDK levels (Play requires targetSdk 36 from 2026-08-31)
#   2. The real Melori launcher icons at every density, plus an adaptive icon
#      whose foreground is the M mark alone, sized to survive OEM masks
#   3. The runtime permissions LiveKit audio/video and media playback need
#   4. The autoVerify App Links intent-filter for https://melorimusic.org
#   5. A release signing config driven by android/key.properties or env vars
#
# Usage:
#   bash scripts/configure-android.sh                # everything
#   bash scripts/configure-android.sh --icons-only   # just the launcher icons
#
# Requires ImageMagick (`magick` or `convert`); on macOS, `brew install
# imagemagick`. The iOS script uses the built-in `sips`, but `sips` cannot
# composite or mask, so it can't build the round or adaptive-foreground icons —
# it would silently emit plain squares. Requiring ImageMagick keeps this script
# honest about failing rather than shipping a wrong icon.
#
# Exits non-zero if the icon source fails its checksum/dimension guard, if any
# expected generated file is missing or the wrong size, or if the adaptive
# foreground would be clipped by a circular launcher mask.
#
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"
SOURCE_ICON="$MOBILE_DIR/resources/icon-1024.png"
PLAY_ICON="$MOBILE_DIR/resources/play-store-icon-512.png"
RES_DIR="$ANDROID_DIR/app/src/main/res"
MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
VARIABLES_GRADLE="$ANDROID_DIR/variables.gradle"
APP_GRADLE="$ANDROID_DIR/app/build.gradle"

# Play policy: new apps must target API 36 from 2026-08-31. Capacitor pins the
# supported target SDK to its major version (8.x -> 36) and does not support
# custom values, so these must stay in lockstep with the Capacitor major.
# https://capacitorjs.com/docs/android/setting-target-sdk
MIN_SDK=24
COMPILE_SDK=36
TARGET_SDK=36

APP_HOST="melorimusic.org"

# The exact flat navy the artwork's own background is filled with. The adaptive
# background layer must be this colour and nothing else: the foreground layer is
# the mark keyed off that same navy, so its anti-aliased edge pixels are navy
# blends. Any other background colour turns those into a visible dark halo.
ADAPTIVE_BACKGROUND="#061826"

# Fraction of the 108dp adaptive canvas that is guaranteed visible under every
# OEM mask. Android reserves the outer 18dp of the 108dp canvas for masking and
# parallax, leaving the centre 72dp (66.7%); a circular mask inscribes a circle
# in that region, so only a centred circle of ~66% of the canvas always
# survives. See https://developer.android.com/develop/ui/views/launch/icon_design_adaptive
SAFE_ZONE_PERCENT=66

# LiveKit needs mic/camera/audio-routing; media playback needs a foreground
# service; Android 13+ needs POST_NOTIFICATIONS for the playback notification.
# The Capacitor template only declares INTERNET.
PERMISSIONS=(
  android.permission.INTERNET
  android.permission.ACCESS_NETWORK_STATE
  android.permission.RECORD_AUDIO
  android.permission.CAMERA
  android.permission.MODIFY_AUDIO_SETTINGS
  android.permission.BLUETOOTH_CONNECT
  android.permission.POST_NOTIFICATIONS
  android.permission.FOREGROUND_SERVICE
  android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK
)

ICONS_ONLY=0
if [ "${1:-}" = "--icons-only" ]; then
  ICONS_ONLY=1
fi

die() { echo "error: $*" >&2; exit 1; }

# shellcheck source=lib/icon-source.sh
. "$MOBILE_DIR/scripts/lib/icon-source.sh"
melori_assert_icon_source "$SOURCE_ICON" || exit 1

[ -d "$ANDROID_DIR" ] || die "$ANDROID_DIR not found. Run 'npx cap add android && npx cap sync android' first."

# --- Image backend ------------------------------------------------------------
if command -v magick >/dev/null 2>&1; then
  IM=magick        # ImageMagick 7
elif command -v convert >/dev/null 2>&1; then
  IM=convert       # ImageMagick 6
else
  die "ImageMagick not found. Install it (macOS: 'brew install imagemagick', Debian/Ubuntu: 'apt-get install imagemagick')."
fi

resize() { # resize <px> <out>
  "$IM" "$SOURCE_ICON" -resize "$1x$1" -strip "$2"
}

round() { # round <px> <out> -- circular mask for ic_launcher_round
  local half=$(( $1 / 2 ))
  "$IM" "$SOURCE_ICON" -resize "$1x$1" \
    \( +clone -alpha extract -draw "fill black polygon 0,0 0,$1 $1,0 fill white circle $half,$half $half,0" \) \
    -alpha off -compose CopyOpacity -composite -strip "$2"
}

foreground() { # foreground <px> <out>
  # The adaptive foreground must be the M mark ALONE on transparency, not the
  # full-bleed square. Dropping the square in here is the trap: its corners --
  # which is exactly where the red stem-dot and the cyan dot sit -- fall outside
  # every circular mask and get sliced off.
  #
  # The artwork's background is a flat $ADAPTIVE_BACKGROUND, so key it out, trim
  # to the mark's bounding box, then scale that box to fit the safe zone. The
  # box is fitted by its DIAGONAL, not its side: a square of side s only fits
  # inside a circle of diameter s*sqrt(2), so sizing by the side would still
  # push the corners out under a circular mask. sqrt(2) ~= 1.41421356, and
  # 10000/14142 keeps the arithmetic integer for Bash.
  local inner=$(( $1 * SAFE_ZONE_PERCENT * 10000 / 14142 / 100 ))
  "$IM" "$SOURCE_ICON" \
    -alpha off -fuzz 6% -transparent "$ADAPTIVE_BACKGROUND" \
    -trim +repage \
    -resize "${inner}x${inner}" \
    -background none -gravity center -extent "$1x$1" \
    -depth 8 -strip "PNG32:$2"
}

# Total opaque coverage lying OUTSIDE the safe-zone circle, in pixels. Masks
# the foreground's alpha with the inverse of the circle a round launcher icon
# would apply, so a non-zero result means the mark really would be clipped.
# Proves the sizing above rather than trusting it.
clipped_pixels() { # clipped_pixels <png> <canvas-px>
  local size="$2"
  local c=$(( size / 2 ))
  local r=$(( size * SAFE_ZONE_PERCENT / 200 ))
  "$IM" "$1" -alpha extract \
    \( -size "${size}x${size}" xc:white -fill black \
       -draw "circle $c,$c $c,$(( c - r ))" \) \
    -compose multiply -composite \
    -format "%[fx:int(mean*w*h+0.5)]" info:
}

# density:legacy-px:adaptive-foreground-px
DENSITIES=(
  "mdpi:48:108"
  "hdpi:72:162"
  "xhdpi:96:216"
  "xxhdpi:144:324"
  "xxxhdpi:192:432"
)

verify_icons() {
  local bad=0 entry density legacy fg dir pair f want got corner clipped
  local play_dims play_channels play_depth

  for entry in "${DENSITIES[@]}"; do
    IFS=: read -r density legacy fg <<<"$entry"
    dir="$RES_DIR/mipmap-$density"

    # Exact dimensions, not just "file exists" -- a silently mis-sized icon is
    # the same class of bug as the placeholder that reached the App Store.
    for pair in "ic_launcher.png:$legacy" "ic_launcher_round.png:$legacy" \
                "ic_launcher_foreground.png:$fg"; do
      f="${pair%:*}"
      want="${pair#*:}"
      if [ ! -s "$dir/$f" ]; then
        echo "error: missing icon $dir/$f" >&2
        bad=1
        continue
      fi
      got="$("$IM" identify -format '%wx%h' "$dir/$f")"
      if [ "$got" != "${want}x${want}" ]; then
        echo "error: $dir/$f is $got, expected ${want}x${want}" >&2
        bad=1
      fi
    done

    # The adaptive foreground must be transparent where the mask crops, and the
    # mark must sit entirely inside the safe-zone circle.
    if [ -s "$dir/ic_launcher_foreground.png" ]; then
      corner="$("$IM" "$dir/ic_launcher_foreground.png" -format '%[fx:int(u.p{0,0}.a*255)]' info:)"
      if [ "$corner" != "0" ]; then
        echo "error: $dir/ic_launcher_foreground.png has an opaque corner (alpha $corner);" \
             "the adaptive foreground must be the mark on transparency, not the full-bleed square" >&2
        bad=1
      fi
      clipped="$(clipped_pixels "$dir/ic_launcher_foreground.png" "$fg")"
      if [ "$clipped" != "0" ]; then
        echo "error: $dir/ic_launcher_foreground.png has ${clipped}px of mark outside the" \
             "${SAFE_ZONE_PERCENT}% safe-zone circle — a round mask would clip it" >&2
        bad=1
      fi
    fi
  done

  # Play requires a 32-bit PNG for the store listing icon.
  if [ ! -s "$PLAY_ICON" ]; then
    echo "error: missing Play store icon $PLAY_ICON" >&2
    bad=1
  else
    play_dims="$("$IM" identify -format '%wx%h' "$PLAY_ICON")"
    play_channels="$("$IM" identify -format '%[channels]' "$PLAY_ICON")"
    play_depth="$("$IM" identify -format '%z' "$PLAY_ICON")"
    if [ "$play_dims" != "512x512" ]; then
      echo "error: $PLAY_ICON is $play_dims, expected 512x512" >&2
      bad=1
    fi
    # 8 bits across R, G, B and A. The alpha channel has to be *present* for
    # Play to accept the upload even though every pixel in it is opaque.
    case "$play_channels" in
      *a*) ;;
      *) echo "error: $PLAY_ICON has channels '$play_channels' — Play requires a" \
              "32-bit PNG, i.e. one with an alpha channel present" >&2
         bad=1 ;;
    esac
    if [ "$play_depth" != "8" ]; then
      echo "error: $PLAY_ICON is ${play_depth}-bit per channel, expected 8" >&2
      bad=1
    fi
  fi

  grep -q "$ADAPTIVE_BACKGROUND" "$RES_DIR/values/ic_launcher_background.xml" 2>/dev/null \
    || { echo "error: adaptive background colour is not $ADAPTIVE_BACKGROUND" >&2; bad=1; }

  return "$bad"
}

# --- 1. Launcher icons --------------------------------------------------------
echo "==> Installing launcher icons from $SOURCE_ICON"

for entry in "${DENSITIES[@]}"; do
  IFS=: read -r density legacy fg <<<"$entry"
  dir="$RES_DIR/mipmap-$density"
  mkdir -p "$dir"
  resize "$legacy" "$dir/ic_launcher.png"
  round "$legacy" "$dir/ic_launcher_round.png"
  foreground "$fg" "$dir/ic_launcher_foreground.png"
  echo "    mipmap-$density: ${legacy}px legacy + ${fg}px adaptive foreground"
done

# The adaptive background is a flat colour resource referenced by
# mipmap-anydpi-v26/ic_launcher.xml; it must match the artwork's own background
# so the keyed foreground's edge pixels blend into it seamlessly.
mkdir -p "$RES_DIR/values"
cat > "$RES_DIR/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$ADAPTIVE_BACKGROUND</color>
</resources>
XML

mkdir -p "$RES_DIR/mipmap-anydpi-v26"
for name in ic_launcher ic_launcher_round; do
  cat > "$RES_DIR/mipmap-anydpi-v26/$name.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XML
done

# Play Console's store listing icon. Unlike everything else here this is not a
# build input -- it is uploaded by hand -- so it lives in resources/ under
# version control rather than in the git-ignored android/ tree, where it was
# regenerated into oblivion on every sync and could not be reviewed in a diff.
#
# Play requires a 32-bit PNG (i.e. with an alpha channel present) even though
# the artwork is fully opaque, hence PNG32: rather than the plain resize().
# Regenerated only when absent or wrong-sized, so a normal configure run leaves
# the working tree clean.
if [ ! -f "$PLAY_ICON" ] || [ "$("$IM" identify -format '%wx%h' "$PLAY_ICON" 2>/dev/null)" != "512x512" ]; then
  echo "    generating $PLAY_ICON"
  "$IM" "$SOURCE_ICON" -resize 512x512 -alpha set -background none \
    -strip "PNG32:$PLAY_ICON"
fi

echo "==> Verifying icons"
verify_icons || die "icon verification failed"

if [ "$ICONS_ONLY" -eq 1 ]; then
  echo "Icons installed and verified (--icons-only)."
  exit 0
fi

# --- 2. SDK levels ------------------------------------------------------------
echo "==> Pinning SDK levels in variables.gradle"
[ -f "$VARIABLES_GRADLE" ] || die "$VARIABLES_GRADLE not found"

python3 - "$VARIABLES_GRADLE" "$MIN_SDK" "$COMPILE_SDK" "$TARGET_SDK" <<'PY'
import re, sys
path, min_sdk, compile_sdk, target_sdk = sys.argv[1:5]
text = open(path).read()
wanted = {
    "minSdkVersion": min_sdk,
    "compileSdkVersion": compile_sdk,
    "targetSdkVersion": target_sdk,
}
for key, value in wanted.items():
    pattern = re.compile(rf"^(\s*){key}\s*=.*$", re.M)
    if pattern.search(text):
        text = pattern.sub(rf"\g<1>{key} = {value}", text, count=1)
    else:
        text = text.replace("ext {", f"ext {{\n    {key} = {value}", 1)
open(path, "w").write(text)
PY

grep -E "minSdkVersion|compileSdkVersion|targetSdkVersion" "$VARIABLES_GRADLE" | sed 's/^/    /'

# --- 3. Manifest permissions + App Links --------------------------------------
echo "==> Patching AndroidManifest.xml"
[ -f "$MANIFEST" ] || die "$MANIFEST not found"

python3 - "$MANIFEST" "$APP_HOST" "${PERMISSIONS[@]}" <<'PY'
import sys

path, host = sys.argv[1], sys.argv[2]
permissions = sys.argv[3:]
text = open(path).read()

missing = [p for p in permissions if f'android:name="{p}"' not in text]
if missing:
    block = "\n".join(
        f'    <uses-permission android:name="{p}" />' for p in missing
    )
    text = text.replace("</manifest>", f"{block}\n</manifest>", 1)

# App Links: verified https deep links so melorimusic.org URLs open in the app.
if "android.intent.action.VIEW" not in text:
    intent_filter = f"""
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="{host}" />
                <data android:scheme="https" android:host="www.{host}" />
            </intent-filter>
"""
    marker = """                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
"""
    if marker not in text:
        raise SystemExit(
            "error: LAUNCHER intent-filter not found in manifest; "
            "the Capacitor template changed and this script needs updating"
        )
    text = text.replace(marker, marker + intent_filter, 1)

open(path, "w").write(text)
print(f"    permissions added: {len(missing)} (total {len(permissions)})")
PY

# --- 4. Release signing config ------------------------------------------------
# android/app/build.gradle is generated, so the signing config is injected here
# rather than committed. Credentials come from android/key.properties (local,
# git-ignored) or from MELORI_* env vars (CI). No secret is ever written by
# this script -- it only wires up the lookup.
echo "==> Wiring release signing config"
[ -f "$APP_GRADLE" ] || die "$APP_GRADLE not found"

if grep -q "melori-signing-config" "$APP_GRADLE"; then
  echo "    already present, skipping"
else
  python3 - "$APP_GRADLE" <<'PY'
import re, sys

path = sys.argv[1]
text = open(path).read()

signing = '''
    // melori-signing-config (injected by scripts/configure-android.sh)
    // Credentials come from android/key.properties (local, git-ignored) or
    // MELORI_* env vars (CI). Release builds are unsigned when absent, so a
    // debug/verification build still works without the keystore.
    signingConfigs {
        release {
            def keystoreProperties = new Properties()
            def keystorePropertiesFile = rootProject.file("key.properties")
            if (keystorePropertiesFile.exists()) {
                keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
            }
            def resolvedStoreFile = keystoreProperties.getProperty("storeFile") ?: System.getenv("MELORI_KEYSTORE_PATH")
            if (resolvedStoreFile) {
                storeFile file(resolvedStoreFile)
                storePassword keystoreProperties.getProperty("storePassword") ?: System.getenv("MELORI_KEYSTORE_PASSWORD")
                keyAlias keystoreProperties.getProperty("keyAlias") ?: System.getenv("MELORI_KEY_ALIAS")
                keyPassword keystoreProperties.getProperty("keyPassword") ?: System.getenv("MELORI_KEY_PASSWORD")
            }
        }
    }
'''

if "signingConfigs" in text:
    raise SystemExit("error: signingConfigs already defined by the template; script needs updating")

marker = "    buildTypes {\n        release {\n"
if marker not in text:
    raise SystemExit("error: release buildType not found in app/build.gradle")

replacement = signing + marker + (
    "            if (signingConfigs.release.storeFile != null) {\n"
    "                signingConfig signingConfigs.release\n"
    "            }\n"
)
text = text.replace(marker, replacement, 1)

# Version name/code are release inputs, not repo constants -- the workflow
# passes them as Gradle properties so nothing is hardcoded here.
text = re.sub(
    r'^(\s*)versionCode 1$',
    r'\1versionCode Integer.parseInt(project.findProperty("meloriVersionCode")?.toString() ?: "1")',
    text, count=1, flags=re.M,
)
text = re.sub(
    r'^(\s*)versionName "1.0"$',
    r'\1versionName project.findProperty("meloriVersionName") ?: "1.0"',
    text, count=1, flags=re.M,
)

open(path, "w").write(text)
PY
  echo "    signing config + versionCode/versionName overrides injected"
fi

# --- 5. Verify ----------------------------------------------------------------
echo "==> Verifying"
failures=0

verify_icons || failures=1

for key in "minSdkVersion = $MIN_SDK" "compileSdkVersion = $COMPILE_SDK" "targetSdkVersion = $TARGET_SDK"; do
  grep -q "$key" "$VARIABLES_GRADLE" || { echo "error: variables.gradle missing '$key'" >&2; failures=1; }
done

for perm in "${PERMISSIONS[@]}"; do
  grep -q "android:name=\"$perm\"" "$MANIFEST" || { echo "error: manifest missing $perm" >&2; failures=1; }
done

grep -q 'android:autoVerify="true"' "$MANIFEST" || { echo "error: App Links intent-filter missing" >&2; failures=1; }
grep -q "$APP_HOST" "$MANIFEST" || { echo "error: manifest missing host $APP_HOST" >&2; failures=1; }
grep -q "melori-signing-config" "$APP_GRADLE" || { echo "error: signing config missing" >&2; failures=1; }

[ "$failures" -eq 0 ] || die "configure-android.sh verification failed"

echo "Android project configured: SDK $MIN_SDK/$COMPILE_SDK/$TARGET_SDK, $(( ${#DENSITIES[@]} * 3 )) icons, App Links + permissions applied."
