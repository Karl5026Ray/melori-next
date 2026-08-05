/* eslint-disable no-console */
//
// scripts/stage-queue.test.ts
//
// VALIDATION TESTS for the raise-hand queue ordering in src/lib/stageQueue.ts.
//
// Regression context: the host-facing "wants to speak" list was built from the
// roster in joined_at order, so whoever raised their hand FIRST was not
// necessarily on top — a live API test of a Cinema room caught guest 2 (who
// raised second) sorting above guest 1. stage_requested_at, stamped by the
// trg_sync_stage_requested_at trigger (migration 028), is the correct key.
//
// Pure functions only — no DB / no network, matching the rest of the
// scripts/*.test.ts suite.
//
// Run:  npx tsx scripts/stage-queue.test.ts  (also: npm run test:stage-queue)

import { compareStageRequests, sortStageQueue } from "@/lib/stageQueue";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
  }
}

const row = (
  user_id: string,
  stage_requested_at: string | null,
  joined_at?: string,
) => ({ user_id, stage_requested_at, joined_at, has_raised_hand: true });

const ids = (rows: { user_id: string }[]) => rows.map((r) => r.user_id);

console.log("\nsortStageQueue");
{
  // The exact production case: g2 joined first, g1 raised first.
  const roster = [
    row("g2", "2026-08-05T00:20:00.000Z", "2026-08-05T00:10:00.000Z"),
    row("g1", "2026-08-05T00:15:00.000Z", "2026-08-05T00:10:01.000Z"),
  ];
  assertEq("oldest request wins over oldest join", ids(sortStageQueue(roster)), [
    "g1",
    "g2",
  ]);

  assertEq(
    "already in order stays in order",
    ids(
      sortStageQueue([
        row("a", "2026-08-05T00:01:00.000Z"),
        row("b", "2026-08-05T00:02:00.000Z"),
        row("c", "2026-08-05T00:03:00.000Z"),
      ]),
    ),
    ["a", "b", "c"],
  );

  assertEq(
    "rows without a timestamp sort last",
    ids(
      sortStageQueue([
        row("nostamp", null),
        row("b", "2026-08-05T00:02:00.000Z"),
        row("a", "2026-08-05T00:01:00.000Z"),
      ]),
    ),
    ["a", "b", "nostamp"],
  );

  assertEq(
    "unparseable timestamp is treated as missing, not as time zero",
    ids(
      sortStageQueue([
        row("junk", "not-a-date"),
        row("real", "2026-08-05T00:02:00.000Z"),
      ]),
    ),
    ["real", "junk"],
  );

  assertEq("empty queue is safe", ids(sortStageQueue([])), []);
  assertEq(
    "single entry is safe",
    ids(sortStageQueue([row("solo", "2026-08-05T00:02:00.000Z")])),
    ["solo"],
  );

  const original = [
    row("b", "2026-08-05T00:02:00.000Z"),
    row("a", "2026-08-05T00:01:00.000Z"),
  ];
  sortStageQueue(original);
  assertEq("does not mutate the caller's array", ids(original), ["b", "a"]);
}

console.log("\ncompareStageRequests");
{
  const early = row("early", "2026-08-05T00:01:00.000Z");
  const late = row("late", "2026-08-05T00:02:00.000Z");
  assertEq("earlier request sorts first", compareStageRequests(early, late) < 0, true);
  assertEq("later request sorts after", compareStageRequests(late, early) > 0, true);
  assertEq("identical timestamps tie", compareStageRequests(early, { ...early }), 0);
  assertEq(
    "two missing timestamps tie (stable order preserved)",
    compareStageRequests(row("x", null), row("y", null)),
    0,
  );
}

console.log(
  failures === 0
    ? "\nAll stage queue tests passed.\n"
    : `\n${failures} stage queue test(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
