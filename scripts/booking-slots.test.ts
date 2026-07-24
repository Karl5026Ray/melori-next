/* eslint-disable no-console */
//
// scripts/booking-slots.test.ts
//
// BOUNDARY TESTS for the photography booking slot generator.
//
// These lock in the slot END-TIME boundary guarantee: a candidate slot is
// only offered when the FULL service duration fits before the availability
// window closes. i.e. for a 9:00-17:00 window:
//   * a 60-min service's LAST slot starts at 16:00 (ends 17:00), NOT 16:30
//   * an 8-hour service yields EXACTLY ONE slot at 09:00 (ends 17:00)
//   * a 30-min service's last slot starts at 16:30 (ends 17:00)
//
// It exercises the SAME pure function the API uses
// (generateSlotStarts in src/lib/booking-availability.ts) with no DB / no
// network, so it is deterministic and fast.
//
// Run:  npx tsx scripts/booking-slots.test.ts   (also: npm run test:slots)
//
// If you change the slot loop condition in booking-availability.ts, these
// assertions are what catch an accidental off-by-one that would let a shoot
// run past closing time.

import { generateSlotStarts } from "@/lib/booking-availability";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// A fixed, DST-free reference day expressed purely in epoch ms. The window is
// an abstract 8-hour block ("09:00"-"17:00"); we only care about relative
// offsets, so we anchor windowStart at 0 for readability.
const WINDOW_START = 0; // "09:00"
const WINDOW_END = 8 * HOUR; // "17:00"

// Notice/advance bounds are wide open so they never filter these cases.
const EARLIEST = -Infinity;
const LATEST = Infinity;

let failures = 0;

function label(ms: number): string {
  // Render an offset from WINDOW_START ("09:00") as a wall-clock-ish HH:MM.
  const totalMin = Math.round(ms / MIN);
  const h = 9 + Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures++;
    console.error(`  \u2717 ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function run(name: string, fn: () => void): void {
  console.log(name);
  fn();
}

// -------------------------------------------------------------------------

run("60-min service, 30-min step, 9-5 window", () => {
  const starts = generateSlotStarts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    serviceMs: 60 * MIN,
    bufferMs: 0,
    stepMs: 30 * MIN,
    earliestAllowed: EARLIEST,
    latestAllowed: LATEST,
    busy: [],
  });
  assertEq("offers 15 slots", starts.length, 15);
  assertEq("first slot is 09:00", label(starts[0]), "09:00");
  // The crux: last START is 16:00 (ends 17:00), NOT 16:30 (which would end 17:30).
  assertEq("last slot is 16:00 (not 16:30)", label(starts[starts.length - 1]), "16:00");
  const lastEnd = starts[starts.length - 1] + 60 * MIN;
  assertEq("last slot ends exactly at 17:00", label(lastEnd), "17:00");
});

run("8-hour service exactly fills the 8-hour window", () => {
  const starts = generateSlotStarts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    serviceMs: 8 * HOUR,
    bufferMs: 0,
    stepMs: 30 * MIN,
    earliestAllowed: EARLIEST,
    latestAllowed: LATEST,
    busy: [],
  });
  assertEq("offers exactly 1 slot", starts.length, 1);
  assertEq("the only slot is 09:00", label(starts[0]), "09:00");
  assertEq("it ends exactly at 17:00", label(starts[0] + 8 * HOUR), "17:00");
});

run("30-min service, 30-min step", () => {
  const starts = generateSlotStarts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    serviceMs: 30 * MIN,
    bufferMs: 0,
    stepMs: 30 * MIN,
    earliestAllowed: EARLIEST,
    latestAllowed: LATEST,
    busy: [],
  });
  assertEq("offers 16 slots", starts.length, 16);
  assertEq("last slot is 16:30 (ends 17:00)", label(starts[starts.length - 1]), "16:30");
});

run("buffer does NOT push the last slot past closing", () => {
  // A 15-min buffer means the service+buffer runs to 17:00 for a slot that
  // starts at 16:00 for a 45-min service... but the LOOP boundary uses
  // serviceMs only (buffer is applied to the busy-overlap check, matching the
  // production behavior). Assert current behavior is preserved: last start is
  // the largest where serviceMs fits.
  const starts = generateSlotStarts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    serviceMs: 60 * MIN,
    bufferMs: 15 * MIN,
    stepMs: 60 * MIN,
    earliestAllowed: EARLIEST,
    latestAllowed: LATEST,
    busy: [],
  });
  assertEq("hourly steps -> 8 slots (09:00..16:00)", starts.length, 8);
  assertEq("last slot is 16:00", label(starts[starts.length - 1]), "16:00");
});

run("busy interval removes the overlapping slot (buffer respected)", () => {
  // Block 12:00-13:00. A 60-min service+0 buffer at 12:00 overlaps; also the
  // 11:00 slot (ends 12:00) must NOT be dropped (touching edges don't overlap).
  const noon = 3 * HOUR; // "12:00"
  const starts = generateSlotStarts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    serviceMs: 60 * MIN,
    bufferMs: 0,
    stepMs: 60 * MIN,
    earliestAllowed: EARLIEST,
    latestAllowed: LATEST,
    busy: [{ start: noon, end: noon + HOUR }],
  });
  const labels = starts.map(label);
  assertEq("11:00 kept (touches busy start, no overlap)", labels.includes("11:00"), true);
  assertEq("12:00 removed (overlaps busy)", labels.includes("12:00"), false);
  assertEq("13:00 kept (touches busy end, no overlap)", labels.includes("13:00"), true);
});

run("min-notice / max-advance bounds filter starts", () => {
  // earliestAllowed = 10:00 -> the 09:00 slot is filtered out.
  const tenAM = 1 * HOUR;
  const starts = generateSlotStarts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    serviceMs: 60 * MIN,
    bufferMs: 0,
    stepMs: 60 * MIN,
    earliestAllowed: tenAM,
    latestAllowed: LATEST,
    busy: [],
  });
  assertEq("first slot is now 10:00 (09:00 filtered by notice)", label(starts[0]), "10:00");
});

// -------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n\u2717 ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\n\u2713 all booking-slot boundary tests passed");
}
