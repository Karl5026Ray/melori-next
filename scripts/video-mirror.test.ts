/* eslint-disable no-console */
// Tests for the MM Faces self-preview mirroring decision (src/lib/videoMirror.ts).
//
// The guarantees that matter:
//  - ONLY the local participant's own tile is ever mirrored — a remote tile
//    must NEVER be mirrored, no matter what facing mode is reported for it.
//  - The local tile mirrors ONLY when the front-facing ("user") camera is
//    active. The rear ("environment") camera, and any unknown/undetected
//    facing mode (e.g. a desktop webcam), must NOT be mirrored — mirroring a
//    rear camera would flip any text/signs in frame backwards.
//  - This is a pure, display-only decision: it has nothing to do with the
//    published/encoded LiveKit track, only the local <video> element's CSS.
//
// Run: npx tsx scripts/video-mirror.test.ts

import { shouldMirrorTile, mirrorTransform, type FacingMode } from "@/lib/videoMirror";

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures += 1;
    console.log(
      `  \u2717 ${label}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`,
    );
  }
}

console.log("\nshouldMirrorTile — local participant, front camera (the ONLY mirrored case)");
assertEq("local + front camera -> mirror", shouldMirrorTile(true, "user"), true);

console.log("\nshouldMirrorTile — local participant, everything else stays un-mirrored");
assertEq("local + rear camera -> no mirror", shouldMirrorTile(true, "environment"), false);
assertEq("local + unknown facing mode -> no mirror", shouldMirrorTile(true, null), false);
assertEq("local + undefined facing mode -> no mirror", shouldMirrorTile(true, undefined), false);

console.log("\nshouldMirrorTile — remote participants are NEVER mirrored, regardless of facing mode");
const facingModes: FacingMode[] = ["user", "environment", null, undefined];
for (const mode of facingModes) {
  assertEq(`remote + facingMode=${String(mode)} -> no mirror`, shouldMirrorTile(false, mode), false);
}

console.log("\nmirrorTransform — the CSS applied for each decision");
assertEq("mirror -> scaleX(-1)", mirrorTransform(true), "scaleX(-1)");
assertEq("no mirror -> none", mirrorTransform(false), "none");

console.log("\ncross-check: mirrorTransform(shouldMirrorTile(...)) end to end");
assertEq(
  "local front camera renders scaleX(-1)",
  mirrorTransform(shouldMirrorTile(true, "user")),
  "scaleX(-1)",
);
assertEq(
  "local rear camera renders none (text in frame stays readable)",
  mirrorTransform(shouldMirrorTile(true, "environment")),
  "none",
);
assertEq(
  "remote tile on front camera still renders none (remote viewers see the real orientation)",
  mirrorTransform(shouldMirrorTile(false, "user")),
  "none",
);

console.log(
  failures === 0
    ? "\nAll video-mirror assertions passed.\n"
    : `\n${failures} video-mirror assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
