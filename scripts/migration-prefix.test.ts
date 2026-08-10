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
// This test found the problem is bigger than #279 described: it also flagged
// 021 and 054 (see KNOWN_UNRESOLVED below), which are tracked as separate
// issues rather than folded into the #279 fix. 048_host_last_seen.sql was
// moved to 055_host_last_seen.sql to resolve the collision this test was
// originally written for (see supabase/migrations/055_host_last_seen.sql
// for why that number and not a re-run of the migration). The 021 collision
// was resolved the same way: 021_social_video_like_comment_counters.sql
// moved to 056_social_video_like_comment_counters.sql (issue #295, see that
// file for the ledger evidence).
//
// Pure file I/O, no DB and no network, matching the rest of scripts/*.test.ts.
//
// Run:  npx tsx scripts/migration-prefix.test.ts

import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

// Prefixes with a known, already-tracked collision that this test does not
// yet enforce. Each one must map to an open issue -- this is a TODO list,
// not a place to quietly bury a new collision. Adding a prefix here without
// opening (or linking) an issue defeats the point of this test.
//
//   054 -- 054_cinema_camera_slots.sql vs
//          054_move_membership_backup_out_of_public.sql, and
//          054_cinema_camera_slots.sql does not appear in the applied
//          ledger at all (looks like the #278 gap, not just the #279
//          collision) -- see #296
const KNOWN_UNRESOLVED = new Set(["054"]);

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
  // A `<n>_rollback.sql` file is a companion script for migration <n>, meant
  // to be run manually to undo it -- it intentionally shares the number and
  // is not part of the apply-order sequence, so it is not a real collision.
  if (/_rollback\.sql$/.test(file)) continue;

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
const newCollisions = collisions.filter(([prefix]) => !KNOWN_UNRESOLVED.has(prefix));
const staleAllowlist = [...KNOWN_UNRESOLVED].filter(
  (prefix) => !collisions.some(([p]) => p === prefix),
);

if (newCollisions.length > 0) {
  for (const [prefix, list] of newCollisions) {
    fail(`prefix ${prefix} is shared by ${list.length} files: ${list.join(", ")}`);
  }
} else {
  pass(
    `no new prefix collisions (${KNOWN_UNRESOLVED.size} pre-existing one(s) tracked in KNOWN_UNRESOLVED)`,
  );
}

if (staleAllowlist.length > 0) {
  for (const prefix of staleAllowlist) {
    fail(
      `KNOWN_UNRESOLVED still lists prefix ${prefix}, but it is no longer ` +
        `collision -- remove it from the allowlist now that it is fixed`,
    );
  }
} else if (KNOWN_UNRESOLVED.size > 0) {
  pass("KNOWN_UNRESOLVED contains no stale (already-fixed) entries");
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED\n` : "\n"),
);
process.exit(failures ? 1 : 0);
