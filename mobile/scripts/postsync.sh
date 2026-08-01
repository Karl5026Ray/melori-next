#!/usr/bin/env bash
#
# Re-apply everything `npx cap sync` throws away.
#
# Both native projects are git-ignored and regenerated from the Capacitor
# template on every sync, so the real icons, SDK levels, permissions and
# signing wiring have to be re-applied afterwards. `npm run sync` chains this.
#
# Each platform is skipped when its folder is absent, so a Mac doing iOS-only
# work and Linux CI doing Android-only work both succeed.
#
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -d "$MOBILE_DIR/ios" ]; then
  echo "--- iOS post-sync ---"
  bash "$MOBILE_DIR/scripts/install-ios-icon.sh"
else
  echo "--- iOS post-sync skipped (no ios/ folder) ---"
fi

if [ -d "$MOBILE_DIR/android" ]; then
  echo "--- Android post-sync ---"
  bash "$MOBILE_DIR/scripts/configure-android.sh"
else
  echo "--- Android post-sync skipped (no android/ folder) ---"
fi
