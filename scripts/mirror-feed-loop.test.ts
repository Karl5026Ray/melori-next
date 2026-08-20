/* eslint-disable no-console */
// Focused behavioral contracts for finite, already-loaded Mirror playback.

import fs from "node:fs";
import path from "node:path";
import {
  MANUAL_NAVIGATION_IDLE_MS,
  canClearManualNavigationGuard,
  getMirrorPlaybackEndAdvance,
  nextMirrorVideoIndex,
  refreshManualNavigationGuard,
  releaseManualNavigationGuard,
  shouldLoopVideoCardMedia,
} from "@/lib/mirrorFeedNavigation";

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(
    `  FAIL ${label}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`,
  );
}

function assert(label: string, value: boolean) {
  assertEq(label, value, true);
}

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

console.log("\nMirror feed looping contracts\n");

assertEq(
  "an intermediate completion advances to the following card",
  nextMirrorVideoIndex(0, 3),
  1,
);
assertEq(
  "the final completion wraps to the already-loaded first card",
  nextMirrorVideoIndex(2, 3),
  0,
);
assertEq(
  "a one-item sequence does not issue a redundant navigation",
  nextMirrorVideoIndex(0, 1),
  null,
);
assertEq(
  "an empty sequence does not issue a navigation",
  nextMirrorVideoIndex(0, 0),
  null,
);
assertEq(
  "a stale negative index is normalized safely before advancing",
  nextMirrorVideoIndex(-1, 3),
  0,
);

assertEq(
  "ordinary VideoFeed cards retain their in-place loop by default",
  shouldLoopVideoCardMedia(false, false),
  true,
);
assertEq(
  "multi-item Mirror cards disable in-place looping to progress the feed",
  shouldLoopVideoCardMedia(false, true),
  false,
);
assertEq(
  "one-item Mirror cards keep their in-place loop",
  shouldLoopVideoCardMedia(true, true),
  true,
);

const intermediate = getMirrorPlaybackEndAdvance({
  videoId: "first",
  activeVideoId: "first",
  activeIndex: 0,
  itemCount: 3,
  pageHeight: 640,
  manualNavigationInProgress: false,
  completionInFlightVideoId: null,
});
assertEq("intermediate completion scrolls to its next card", intermediate?.scrollTop, 640);

const wrapped = getMirrorPlaybackEndAdvance({
  videoId: "last",
  activeVideoId: "last",
  activeIndex: 2,
  itemCount: 3,
  pageHeight: 640,
  manualNavigationInProgress: false,
  completionInFlightVideoId: null,
});
assertEq("final completion wraps to scrollTop zero", wrapped?.scrollTop, 0);
assertEq("final completion wraps to index zero", wrapped?.nextIndex, 0);
assert(
  "a playback transition has no pagination or refetch action",
  wrapped !== null && !("cursor" in wrapped) && !("fetch" in wrapped),
);
assertEq(
  "manual navigation intent wins over a stale completion before React commits",
  getMirrorPlaybackEndAdvance({
    videoId: "departing",
    activeVideoId: "departing",
    activeIndex: 0,
    itemCount: 3,
    pageHeight: 640,
    manualNavigationInProgress: true,
    completionInFlightVideoId: null,
  }),
  null,
);
assertEq(
  "a duplicate completion signal cannot advance a second time",
  getMirrorPlaybackEndAdvance({
    videoId: "first",
    activeVideoId: "first",
    activeIndex: 0,
    itemCount: 3,
    pageHeight: 640,
    manualNavigationInProgress: false,
    completionInFlightVideoId: "first",
  }),
  null,
);

const boundaryWheel = refreshManualNavigationGuard(null, false, 1_000);
assertEq(
  "a boundary wheel blocks a completion while the gesture is active",
  getMirrorPlaybackEndAdvance({
    videoId: "first",
    activeVideoId: "first",
    activeIndex: 0,
    itemCount: 3,
    pageHeight: 640,
    manualNavigationInProgress: boundaryWheel !== null,
    completionInFlightVideoId: null,
  }),
  null,
);
assertEq(
  "a boundary wheel guard remains through its quiet window",
  canClearManualNavigationGuard(
    boundaryWheel,
    1_000 + MANUAL_NAVIGATION_IDLE_MS - 1,
  ),
  false,
);
assertEq(
  "a boundary wheel guard eventually clears after inactivity",
  canClearManualNavigationGuard(
    boundaryWheel,
    1_000 + MANUAL_NAVIGATION_IDLE_MS,
  ),
  true,
);
assertEq(
  "completion advances again after a no-op wheel guard clears",
  getMirrorPlaybackEndAdvance({
    videoId: "first",
    activeVideoId: "first",
    activeIndex: 0,
    itemCount: 3,
    pageHeight: 640,
    manualNavigationInProgress: false,
    completionInFlightVideoId: null,
  })?.nextIndex,
  1,
);

const noOpDrag = refreshManualNavigationGuard(null, true, 2_000);
assertEq(
  "an insufficient drag stays guarded while its pointer is still down",
  canClearManualNavigationGuard(
    noOpDrag,
    2_000 + MANUAL_NAVIGATION_IDLE_MS + 100,
  ),
  false,
);
const releasedNoOpDrag = releaseManualNavigationGuard(noOpDrag, 2_200);
assertEq(
  "an insufficient drag clears only after pointer release plus inactivity",
  canClearManualNavigationGuard(
    releasedNoOpDrag,
    2_200 + MANUAL_NAVIGATION_IDLE_MS,
  ),
  true,
);

const activeSwipe = refreshManualNavigationGuard(null, true, 3_000);
const momentum = releaseManualNavigationGuard(activeSwipe, 3_100);
const refreshedMomentum = refreshManualNavigationGuard(momentum, undefined, 3_450);
assertEq(
  "a stale ended event remains blocked during refreshed swipe momentum",
  getMirrorPlaybackEndAdvance({
    videoId: "departing",
    activeVideoId: "departing",
    activeIndex: 0,
    itemCount: 3,
    pageHeight: 640,
    manualNavigationInProgress:
      !canClearManualNavigationGuard(
        refreshedMomentum,
        3_450 + MANUAL_NAVIGATION_IDLE_MS - 1,
      ),
    completionInFlightVideoId: null,
  }),
  null,
);

const mirrorFeed = read("src/components/social/mirror/MirrorFeed.tsx");
const videoCard = read("src/components/social/video/VideoCard.tsx");
const endHandler = mirrorFeed.slice(
  mirrorFeed.indexOf("const handlePlaybackEnded"),
  mirrorFeed.indexOf("// Active-card tracking"),
);

assert(
  "Mirror wires each VideoCard completion to the feed handler",
  mirrorFeed.includes("onPlaybackEnded={handlePlaybackEnded}"),
);
assert(
  "manual pointer and wheel navigation set the immediate guard",
  mirrorFeed.includes("onPointerMove=") &&
    mirrorFeed.includes("onWheel={() => markManualNavigationIntent(false)}") &&
    mirrorFeed.includes("manualNavigationRef.current"),
);
assert(
  "manual guards have timer and scroll-settle cleanup",
  mirrorFeed.includes("scheduleManualNavigationClear") &&
    mirrorFeed.includes("clearManualNavigationTimer") &&
    mirrorFeed.includes("setPointerCapture(event.pointerId)") &&
    mirrorFeed.includes('addEventListener("scrollend", onScrollEnd)') &&
    mirrorFeed.includes('removeEventListener("scrollend", onScrollEnd)'),
);
assert(
  "the end handler does not paginate or refetch",
  !endHandler.includes("loadMore") && !endHandler.includes("fetch("),
);
assert(
  "VideoCard applies the explicit default-loop contract to native and YouTube media",
  videoCard.includes("loop={loopInPlace}") &&
    videoCard.includes("loop: loopInPlace"),
);

console.log(
  failures === 0
    ? "\nAll Mirror feed looping contracts passed.\n"
    : `\n${failures} Mirror feed looping contract(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
