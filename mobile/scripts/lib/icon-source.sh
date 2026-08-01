#!/usr/bin/env bash
#
# Shared validation of the Melori icon source, used by install-ios-icon.sh and
# configure-android.sh.
#
# WHY THIS EXISTS
# ---------------
# A placeholder AppIcon-1024.png once shipped to App Store Connect because the
# generated native project was taken as-is and nothing asserted that the icon
# it was built from was the real artwork. Filename and file-existence checks
# are not enough: a truncated download, an LFS pointer, or a re-exported
# "close enough" file all pass those. So the source is pinned by content hash
# and by its PNG header, and both scripts refuse to run when it does not match.
#
# Deliberately depends on nothing but coreutils so it works identically on the
# macOS iOS runner (which only has `sips`) and the Linux Android runner (which
# only has ImageMagick).
#
# Usage:
#   . "$(dirname "${BASH_SOURCE[0]}")/lib/icon-source.sh"
#   melori_assert_icon_source "$SOURCE_ICON"

# A real 1024x1024 photographic-quality PNG of this mark is ~380 KB. A flat
# placeholder, an LFS pointer or a truncated file is orders of magnitude
# smaller, so this catches them before the hash comparison even runs.
MELORI_ICON_MIN_BYTES=100000
MELORI_ICON_EXPECTED_WIDTH=1024
MELORI_ICON_EXPECTED_HEIGHT=1024

melori_sha256() { # melori_sha256 <file> -> lowercase hex digest
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "error: neither sha256sum nor shasum found" >&2
    return 1
  fi
}

melori_file_bytes() { # melori_file_bytes <file>
  wc -c <"$1" | tr -d '[:space:]'
}

# Reads width and height straight out of the PNG IHDR chunk (bytes 16..23,
# two big-endian uint32s). Avoids depending on an image tool, which differs
# between the macOS and Linux runners.
melori_png_dimensions() { # melori_png_dimensions <file> -> "<width> <height>"
  od -An -v -tu1 -j16 -N8 "$1" | awk '{
    printf "%d %d", $1*16777216 + $2*65536 + $3*256 + $4,
                    $5*16777216 + $6*65536 + $7*256 + $8
  }'
}

melori_is_png() { # melori_is_png <file>
  [ "$(od -An -v -tx1 -N8 "$1" | tr -d ' \n')" = "89504e470d0a1a0a" ]
}

# Fails loudly (non-zero) when the icon source is absent, empty, not a PNG,
# not 1024x1024, or does not match the committed checksum.
melori_assert_icon_source() { # melori_assert_icon_source <source-icon>
  local src="$1"
  local checksum_file="$src.sha256"

  if [ ! -f "$src" ]; then
    echo "error: icon source missing at $src" >&2
    return 1
  fi

  local bytes
  bytes="$(melori_file_bytes "$src")"
  if [ "$bytes" -lt "$MELORI_ICON_MIN_BYTES" ]; then
    echo "error: icon source $src is only ${bytes} bytes — expected at least" \
         "${MELORI_ICON_MIN_BYTES}. This looks like a placeholder, a truncated" \
         "file or a Git LFS pointer, not the real artwork." >&2
    return 1
  fi

  if ! melori_is_png "$src"; then
    echo "error: icon source $src is not a PNG (bad magic bytes)." >&2
    return 1
  fi

  local dims width height
  dims="$(melori_png_dimensions "$src")"
  width="${dims% *}"
  height="${dims#* }"
  if [ "$width" != "$MELORI_ICON_EXPECTED_WIDTH" ] || [ "$height" != "$MELORI_ICON_EXPECTED_HEIGHT" ]; then
    echo "error: icon source $src is ${width}x${height} — expected" \
         "${MELORI_ICON_EXPECTED_WIDTH}x${MELORI_ICON_EXPECTED_HEIGHT}." >&2
    return 1
  fi

  if [ ! -f "$checksum_file" ]; then
    echo "error: checksum file missing at $checksum_file. It pins the icon" \
         "artwork so a placeholder cannot silently take its place; recreate it" \
         "with: shasum -a 256 \"$src\" | awk '{print \$1}' > \"$checksum_file\"" >&2
    return 1
  fi

  local expected actual
  expected="$(tr -d '[:space:]' <"$checksum_file")"
  actual="$(melori_sha256 "$src")" || return 1
  if [ "$expected" != "$actual" ]; then
    echo "error: icon source $src does not match its pinned checksum." >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    echo "  If you intentionally changed the artwork, update $checksum_file" >&2
    echo "  and regenerate mobile/resources/play-store-icon-512.png." >&2
    return 1
  fi

  echo "icon source verified: ${width}x${height}, ${bytes} bytes, sha256 ${actual}"
}
