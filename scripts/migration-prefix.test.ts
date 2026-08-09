// scripts/migration-prefix.test.ts
//
// GUARD TEST for issue #279 — two migration files sharing the same numeric
// prefix (048_host_last_seen.sql and 048_single_price_floor_199.sql).
//
// The numeric prefix on a migration filename is the ordering contract: it is
// how a human (and any tooling) reasons about apply order and maps the
// applied-migration ledger back to a file on disk. When two files share a
// prefix, apply order falls back to filesystem sort instead of intent, and —
// as happened with 039 (see PR #193) and again with 048 (issue #279) — the
// Supabase ledger can record one of them under a name that silently drops
// the numeric prefix, making the collision even harder to trace later.
//
// This has now happened twice. This test makes a third collision fail CI
// instead of quietly shipping. 048_host_last_seen.sql was moved to
// 055_host_last_seen.sql to resolve the collision this test was written for
// (see supabase/migrations/055_host_last_seen.sql for why that number and
// not a re-run of the migration).
//
// Pure file I/O, no DB and no network, matching the rest of scripts/*.test.ts.
//
// Run:  npx tsx scripts/migration-prefix.test.ts

import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

let checks = 0;
let failures = 0;

function pass(label: string) {
  checks += 1;
  console.log(`  ok    ${label}`);
}

function fail(label: string) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label}`);
}

console.log("\nmigration filename prefix guard (#279)\n");

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

const byPrefix = new Map<string, string[]>();
const unprefixed: string[] = [];

for (const file of files) {
  const m = /^(\d+)_/.exec(file);
  if (!m) {
    unprefixed.push(file);
    continue;
  }
  const prefix = m[1];
  const list = byPrefix.get(prefix) ?? [];
  list.push(file);
  byPrefix.set(prefix, list);
}

if (unprefixed.length > 0) {
  fail(
    `${unprefixed.length} migration file(s) have no leading numeric prefix: ` +
      unprefixed.join(", "),
  );
} else {
  pass("every migration file has a leading numeric prefix");
}

const collisions = [...byPrefix.entries()].filter(([, list]) => list.length > 1);

if (collisions.length > 0) {
  for (const [prefix, list] of collisions) {
    fail(`prefix ${prefix} is shared by ${list.length} files: ${list.join(", ")}`);
  }
} else {
  pass(`all ${byPrefix.size} numeric prefixes in supabase/migrations/ are unique`);
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED\n` : "\n"),
);
process.exit(failures ? 1 : 0);
