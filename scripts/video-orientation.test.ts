/* eslint-disable no-console */
// Tests for the Mirror playback-stage decision (src/lib/videoOrientation.ts).
//
// The bug this pins: every native post played inside a fixed 9:16 portrait
// stage, so a landscape clip filled only its width and left thick black bars
// above and below. Posted lives always hit it, because a LiveKit RoomComposite
// is rendered landscape. The guarantees that matter:
//
//  - A landscape clip gets the landscape stage.
//  - A portrait clip gets the portrait stage.
//  - Square is treated as vertical (it fills 9:16 far better than 16:9).
//  - Unmeasured (null/undefined) keeps the portrait stage, so every post made
//    before orientation was recorded renders exactly as it always has.
//  - Unreadable dimensions produce null, never a guess.
//
// Run: npx tsx scripts/video-orientation.test.ts

import {
  isVerticalFromDimensions,
  stageClassName,
  PORTRAIT_STAGE,
  LANDSCAPE_STAGE,
} from "@/lib/videoOrientation";

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(
      `  ✗ ${label}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`,
    );
  }
}

console.log("\nisVerticalFromDimensions — real capture shapes");
assertEq("1080x1920 phone portrait -> vertical", isVerticalFromDimensions(1080, 1920), true);
assertEq("1280x720 LiveKit composite -> landscape", isVerticalFromDimensions(1280, 720), false);
assertEq("640x480 default webcam -> landscape", isVerticalFromDimensions(640, 480), false);
assertEq("720x720 square -> vertical", isVerticalFromDimensions(720, 720), true);

console.log("\nisVerticalFromDimensions — unreadable metadata is never guessed");
assertEq("zero width -> null", isVerticalFromDimensions(0, 1920), null);
assertEq("zero height -> null", isVerticalFromDimensions(1080, 0), null);
assertEq("null width -> null", isVerticalFromDimensions(null, 1920), null);
assertEq("undefined height -> null", isVerticalFromDimensions(1080, undefined), null);
assertEq("negative dimension -> null", isVerticalFromDimensions(-1080, 1920), null);

console.log("\nstageClassName — only an explicit false changes the stage");
assertEq("false -> landscape stage", stageClassName(false), LANDSCAPE_STAGE);
assertEq("true -> portrait stage", stageClassName(true), PORTRAIT_STAGE);
assertEq("null (legacy post) -> portrait stage", stageClassName(null), PORTRAIT_STAGE);
assertEq("undefined (field not selected) -> portrait stage", stageClassName(undefined), PORTRAIT_STAGE);

console.log("\ncross-check: measured dimensions end to end");
assertEq(
  "a posted live (1280x720) lands on the landscape stage",
  stageClassName(isVerticalFromDimensions(1280, 720)),
  LANDSCAPE_STAGE,
);
assertEq(
  "a phone reel (1080x1920) lands on the portrait stage",
  stageClassName(isVerticalFromDimensions(1080, 1920)),
  PORTRAIT_STAGE,
);
assertEq(
  "an unreadable clip falls back to the portrait stage",
  stageClassName(isVerticalFromDimensions(null, null)),
  PORTRAIT_STAGE,
);

console.log(
  failures === 0
    ? "\nAll video-orientation assertions passed.\n"
    : `\n${failures} video-orientation assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
