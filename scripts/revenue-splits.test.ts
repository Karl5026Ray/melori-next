/* eslint-disable no-console */
//
// scripts/revenue-splits.test.ts
//
// MONEY TESTS for the collaborator revenue-split allocator.
//
// The one invariant that must never break: the cents paid out to collaborators
// sum EXACTLY to the net amount available. Not approximately — exactly. A
// naive `Math.round(total * bps / 10000)` per share either invents cents (the
// platform balance comes up short and Stripe rejects the last transfer) or
// drops them (money silently stranded on the platform account, which is a
// bookkeeping problem nobody notices for months).
//
// These exercise the pure functions in src/lib/revenue-splits.ts — no DB, no
// Stripe, no network — so they are deterministic and fast.
//
// Run:  npx tsx scripts/revenue-splits.test.ts   (also: npm run test:splits)

import {
  TOTAL_BASIS_POINTS,
  allocateCents,
  ownerBasisPoints,
  percentToBasisPoints,
  planTransfers,
  validateSplits,
} from "@/lib/revenue-splits";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function assertThrows(name: string, fn: () => unknown): void {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${name}\n      expected: throw\n      actual:   returned`);
  } catch {
    console.log(`  ✓ ${name}`);
  }
}

function run(name: string, fn: () => void): void {
  console.log(name);
  fn();
}

function sum(allocations: Array<{ amountCents: number }>): number {
  return allocations.reduce((t, a) => t + a.amountCents, 0);
}

// -------------------------------------------------------------------------

run("no collaborators: the uploading artist keeps 100%", () => {
  assertEq("ownerBasisPoints([]) is 10000", ownerBasisPoints([]), TOTAL_BASIS_POINTS);
  const v = validateSplits([]);
  assertEq("empty split set is valid", v.valid, true);
  assertEq("owner holds the full remainder", v.ownerBps, TOTAL_BASIS_POINTS);
});

run("clean 50/50 on an even amount", () => {
  const out = allocateCents(1000, [
    { key: "owner", basisPoints: 5000 },
    { key: "co", basisPoints: 5000 },
  ]);
  assertEq("owner gets 500", out[0].amountCents, 500);
  assertEq("collaborator gets 500", out[1].amountCents, 500);
  assertEq("sums to the total", sum(out), 1000);
});

run("50/50 on an ODD amount does not lose the stray cent", () => {
  const out = allocateCents(999, [
    { key: "owner", basisPoints: 5000 },
    { key: "co", basisPoints: 5000 },
  ]);
  assertEq("sums to exactly 999", sum(out), 999);
  assertEq("split is 500/499", [out[0].amountCents, out[1].amountCents], [500, 499]);
});

run("three-way 33.33/33.33/33.34 on $9.99", () => {
  // The classic case. Naive rounding gives 333+333+333 = 999 by luck here, but
  // largest-remainder must hold for the general case too — see the sweep below.
  const out = allocateCents(999, [
    { key: "a", basisPoints: 3333 },
    { key: "b", basisPoints: 3333 },
    { key: "c", basisPoints: 3334 },
  ]);
  assertEq("sums to exactly 999", sum(out), 999);
  assertEq("largest share gets the extra cent", out[2].amountCents, 333);
});

run("pathological thirds: 1 cent across three equal payees", () => {
  const out = allocateCents(1, [
    { key: "a", basisPoints: 3334 },
    { key: "b", basisPoints: 3333 },
    { key: "c", basisPoints: 3333 },
  ]);
  assertEq("sums to exactly 1", sum(out), 1);
  assertEq("the single cent goes to the largest share", out[0].amountCents, 1);
  assertEq("nobody else is paid", [out[1].amountCents, out[2].amountCents], [0, 0]);
});

run("many tiny shares still conserve every cent", () => {
  // 7 payees at 1428/1428/1428/1428/1428/1428/1432 bps of $0.99.
  const shares = [
    { key: "a", basisPoints: 1428 },
    { key: "b", basisPoints: 1428 },
    { key: "c", basisPoints: 1428 },
    { key: "d", basisPoints: 1428 },
    { key: "e", basisPoints: 1428 },
    { key: "f", basisPoints: 1428 },
    { key: "g", basisPoints: 1432 },
  ];
  const out = allocateCents(99, shares);
  assertEq("sums to exactly 99", sum(out), 99);
  assertEq("no negative allocations", out.every((o) => o.amountCents >= 0), true);
});

run("exhaustive sweep: money is never created or destroyed", () => {
  // Every total from 0..1500 cents against several split shapes. This is the
  // real guarantee — any regression in the remainder loop shows up here.
  const shapes = [
    [5000, 5000],
    [3333, 3333, 3334],
    [1000, 9000],
    [1, 9999],
    [2500, 2500, 2500, 2500],
    [1428, 1428, 1428, 1428, 1428, 1428, 1432],
    [10000],
  ];
  let mismatches = 0;
  let negatives = 0;
  for (const shape of shapes) {
    const shares = shape.map((bps, i) => ({ key: `p${i}`, basisPoints: bps }));
    for (let total = 0; total <= 1500; total++) {
      const out = allocateCents(total, shares);
      if (sum(out) !== total) mismatches++;
      if (out.some((o) => o.amountCents < 0)) negatives++;
    }
  }
  assertEq("zero totals mismatched across 10507 cases", mismatches, 0);
  assertEq("zero negative allocations", negatives, 0);
});

run("allocation is deterministic across replays", () => {
  const shares = [
    { key: "a", basisPoints: 3333 },
    { key: "b", basisPoints: 3333 },
    { key: "c", basisPoints: 3334 },
  ];
  const first = allocateCents(1_000_003, shares).map((o) => o.amountCents);
  const second = allocateCents(1_000_003, shares).map((o) => o.amountCents);
  assertEq("same input yields the same cents", first, second);
});

run("zero-priced (free) item allocates nothing without throwing", () => {
  const out = allocateCents(0, [
    { key: "owner", basisPoints: 7000 },
    { key: "co", basisPoints: 3000 },
  ]);
  assertEq("everyone gets 0", out.map((o) => o.amountCents), [0, 0]);
  assertEq("sums to 0", sum(out), 0);
});

run("allocateCents rejects nonsense totals", () => {
  assertThrows("negative total throws", () =>
    allocateCents(-1, [{ key: "a", basisPoints: 10000 }]),
  );
  assertThrows("fractional total throws", () =>
    allocateCents(10.5, [{ key: "a", basisPoints: 10000 }]),
  );
});

// -------------------------------------------------------------------------

run("validateSplits enforces a sane range", () => {
  assertEq(
    "collaborators over 100% are rejected",
    validateSplits([{ basisPoints: 6000 }, { basisPoints: 5000 }]).valid,
    false,
  );
  assertEq(
    "a zero share is rejected",
    validateSplits([{ basisPoints: 0 }]).valid,
    false,
  );
  assertEq(
    "a negative share is rejected",
    validateSplits([{ basisPoints: -100 }]).valid,
    false,
  );
  assertEq(
    "a fractional basis point is rejected",
    validateSplits([{ basisPoints: 12.5 }]).valid,
    false,
  );
  const exact = validateSplits([{ basisPoints: 4000 }, { basisPoints: 6000 }]);
  assertEq("collaborators may take the full 100%", exact.valid, true);
  assertEq("owner remainder is then 0", exact.ownerBps, 0);
});

run("percentToBasisPoints handles two decimal places only", () => {
  assertEq("50 -> 5000", percentToBasisPoints(50), 5000);
  assertEq("33.33 -> 3333", percentToBasisPoints(33.33), 3333);
  assertEq("0.01 -> 1", percentToBasisPoints(0.01), 1);
  assertEq("100 -> 10000", percentToBasisPoints(100), 10000);
  assertEq("0 is rejected", percentToBasisPoints(0), null);
  assertEq("over 100 is rejected", percentToBasisPoints(100.01), null);
  assertEq("three decimals rejected", percentToBasisPoints(33.333), null);
  assertEq("NaN rejected", percentToBasisPoints(Number.NaN), null);
});

// -------------------------------------------------------------------------

const OWNER = {
  profileId: "owner-profile",
  email: "owner@example.com",
  name: "Owner",
  connectedAccountId: "acct_owner",
};

run("planTransfers with no collaborators pays the owner everything", () => {
  const plan = planTransfers(1000, OWNER, []);
  assertEq("one payee", plan.length, 1);
  assertEq("owner takes the full net", plan[0].amountCents, 1000);
  assertEq("marked paid", plan[0].status, "paid");
  assertEq("flagged as owner", plan[0].isOwner, true);
});

run("planTransfers holds a share as owed when the payee has no Connect account", () => {
  const plan = planTransfers(1000, OWNER, [
    {
      key: "co",
      basisPoints: 2500,
      profileId: null,
      email: "co@example.com",
      name: "Co",
      connectedAccountId: null,
    },
  ]);
  assertEq("owner is paid 750", plan[0].amountCents, 750);
  assertEq("owner status paid", plan[0].status, "paid");
  assertEq("collaborator allocated 250", plan[1].amountCents, 250);
  assertEq("collaborator recorded as owed, not dropped", plan[1].status, "owed");
  assertEq("total still equals the net", sum(plan), 1000);
});

run("planTransfers omits the owner when collaborators take 100%", () => {
  const plan = planTransfers(999, OWNER, [
    {
      key: "a",
      basisPoints: 5000,
      profileId: "a",
      email: null,
      name: "A",
      connectedAccountId: "acct_a",
    },
    {
      key: "b",
      basisPoints: 5000,
      profileId: "b",
      email: null,
      name: "B",
      connectedAccountId: "acct_b",
    },
  ]);
  assertEq("only the two collaborators", plan.length, 2);
  assertEq("no owner row", plan.some((p) => p.isOwner), false);
  assertEq("total equals the net", sum(plan), 999);
});

run("planTransfers marks a sub-cent share owed rather than transferring 0", () => {
  // 1 bps of 99 cents rounds to 0 — Stripe will not accept a 0-cent transfer.
  const plan = planTransfers(99, OWNER, [
    {
      key: "tiny",
      basisPoints: 1,
      profileId: "tiny",
      email: null,
      name: "Tiny",
      connectedAccountId: "acct_tiny",
    },
  ]);
  const tiny = plan.find((p) => p.key === "tiny")!;
  assertEq("tiny share rounds to 0 cents", tiny.amountCents, 0);
  assertEq("and is not attempted as a transfer", tiny.status, "owed");
  assertEq("owner still receives the whole 99", sum(plan), 99);
});

// -------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\n✓ all revenue-split money tests passed");
}
