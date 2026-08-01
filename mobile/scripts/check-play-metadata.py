#!/usr/bin/env python3
"""Validate the fastlane/supply metadata tree against Play's listing limits.

    python3 mobile/scripts/check-play-metadata.py

Play silently truncates nothing -- it rejects the edit -- and the listing is
pushed by CI from these files, so an over-length string is a failed release,
not a cosmetic problem. Run in CI on any change under mobile/fastlane/metadata.

Deliberately stdlib-only: PNG geometry is read straight out of the IHDR chunk
(the same trick scripts/lib/icon-source.sh uses) so the check job needs nothing
installed and stays fast enough to run on every pull request.
"""
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALE_DIR = os.path.join(HERE, "..", "fastlane", "metadata", "android", "en-US")

# https://support.google.com/googleplay/android-developer/answer/9859455
TEXT_LIMITS = {
    "title.txt": 30,
    "short_description.txt": 80,
    "full_description.txt": 4000,
}
CHANGELOG_LIMIT = 500

# Play graphic asset specs.
ICON = (512, 512)
FEATURE_GRAPHIC = (1024, 500)
SCREENSHOT_MIN_SIDE = 320
SCREENSHOT_MAX_SIDE = 3840
SCREENSHOT_MIN_COUNT = 2
SCREENSHOT_MAX_COUNT = 8

failures = []


def fail(message):
    failures.append(message)


def png_header(path):
    """(width, height, bit_depth, colour_type) from the IHDR chunk."""
    with open(path, "rb") as handle:
        head = handle.read(26)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    width, height = struct.unpack(">II", head[16:24])
    return width, height, head[24], head[25]


def check_text():
    for name, limit in TEXT_LIMITS.items():
        path = os.path.join(LOCALE_DIR, name)
        if not os.path.exists(path):
            fail(f"{name}: missing")
            continue
        text = open(path, encoding="utf-8").read().strip()
        if not text:
            fail(f"{name}: empty")
            continue
        count = len(text)
        if count > limit:
            fail(f"{name}: {count} characters, Play allows {limit}")
        else:
            print(f"  ok  {name:<24} {count}/{limit} characters")

    changelogs = os.path.join(LOCALE_DIR, "changelogs")
    entries = sorted(f for f in os.listdir(changelogs) if f.endswith(".txt"))
    if not entries:
        fail("changelogs/: no release notes; supply needs <versionCode>.txt")
    for name in entries:
        stem = name[:-4]
        if not stem.isdigit():
            fail(f"changelogs/{name}: name must be the integer versionCode")
        count = len(open(os.path.join(changelogs, name), encoding="utf-8").read().strip())
        if count > CHANGELOG_LIMIT:
            fail(f"changelogs/{name}: {count} characters, Play allows {CHANGELOG_LIMIT}")
        else:
            print(f"  ok  changelogs/{name:<13} {count}/{CHANGELOG_LIMIT} characters")


def check_image(relative, expected):
    path = os.path.join(LOCALE_DIR, "images", relative)
    if not os.path.exists(path):
        fail(f"images/{relative}: missing (broken symlink?)")
        return
    width, height, depth, colour_type = png_header(path)
    if (width, height) != expected:
        fail(f"images/{relative}: {width}x{height}, expected {expected[0]}x{expected[1]}")
        return
    print(f"  ok  images/{relative:<17} {width}x{height} depth {depth} colour type {colour_type}")
    # Play wants a 32-bit PNG for the listing icon: 8 bits across RGBA, i.e.
    # colour type 6. Every pixel is opaque but the channel has to be present.
    if relative == "icon.png" and (depth, colour_type) != (8, 6):
        fail(f"images/icon.png: depth {depth} colour type {colour_type}, Play requires a 32-bit PNG (depth 8, colour type 6)")


def check_screenshots():
    directory = os.path.join(LOCALE_DIR, "images", "phoneScreenshots")
    shots = sorted(f for f in os.listdir(directory) if f.endswith(".png"))
    if not SCREENSHOT_MIN_COUNT <= len(shots) <= SCREENSHOT_MAX_COUNT:
        fail(
            f"images/phoneScreenshots: {len(shots)} frames, Play requires "
            f"{SCREENSHOT_MIN_COUNT}-{SCREENSHOT_MAX_COUNT}"
        )
    for name in shots:
        width, height, _, _ = png_header(os.path.join(directory, name))
        if not all(SCREENSHOT_MIN_SIDE <= side <= SCREENSHOT_MAX_SIDE for side in (width, height)):
            fail(
                f"images/phoneScreenshots/{name}: {width}x{height}, every side must be "
                f"{SCREENSHOT_MIN_SIDE}-{SCREENSHOT_MAX_SIDE}px"
            )
        else:
            print(f"  ok  phoneScreenshots/{name:<24} {width}x{height}")


print(f"Checking {os.path.normpath(LOCALE_DIR)}")
check_text()
check_image("icon.png", ICON)
check_image("featureGraphic.png", FEATURE_GRAPHIC)
check_screenshots()

if failures:
    print("\nPlay listing metadata is invalid:", file=sys.stderr)
    for problem in failures:
        print(f"  {problem}", file=sys.stderr)
    sys.exit(1)
print("\nPlay listing metadata OK")
