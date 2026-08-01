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
#   2. The real Melori launcher icons at every density + the adaptive icon
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
# Exits non-zero if the icon source or any expected generated file is missing.
#
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"
SOURCE_ICON="$MOBILE_DIR/resources/icon-1024.png"
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
ADAPTIVE_BACKGROUND="#111111"

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

[ -f "$SOURCE_ICON" ] || die "source icon missing at $SOURCE_ICON"
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
  # Adaptive icons render a 108dp canvas but only the centre 72dp is guaranteed
  # visible (the launcher masks and parallaxes the rest), so the mark is scaled
  # to 2/3 of the canvas and centred on transparency.
  local inner=$(( $1 * 2 / 3 ))
  "$IM" -size "$1x$1" xc:none \
    \( "$SOURCE_ICON" -resize "${inner}x${inner}" \) \
    -gravity center -composite -depth 8 -strip "$2"
}

# --- 1. Launcher icons --------------------------------------------------------
echo "==> Installing launcher icons from $SOURCE_ICON"

# density:legacy-px:adaptive-foreground-px
DENSITIES=(
  "mdpi:48:108"
  "hdpi:72:162"
  "xhdpi:96:216"
  "xxhdpi:144:324"
  "xxxhdpi:192:432"
)

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
# mipmap-anydpi-v26/ic_launcher.xml; match the app's dark background.
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

# Play Console also wants a 512x512 store icon; emit it next to the project so
# the release build has one to hand rather than re-exporting by hand.
mkdir -p "$ANDROID_DIR/app/src/main/play"
resize 512 "$ANDROID_DIR/app/src/main/play/store-icon-512.png"

if [ "$ICONS_ONLY" -eq 1 ]; then
  echo "Icons installed (--icons-only)."
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

for entry in "${DENSITIES[@]}"; do
  IFS=: read -r density _ _ <<<"$entry"
  for f in ic_launcher.png ic_launcher_round.png ic_launcher_foreground.png; do
    if [ ! -s "$RES_DIR/mipmap-$density/$f" ]; then
      echo "error: missing icon $RES_DIR/mipmap-$density/$f" >&2
      failures=1
    fi
  done
done

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
