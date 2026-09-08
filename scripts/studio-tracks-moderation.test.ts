/* eslint-disable no-console */
//
// scripts/studio-tracks-moderation.test.ts
//
// GUARD TEST for the takedown lever added in migration 049.
//
// studio_tracks.moderation_status is the only thing standing between a valid
// DMCA takedown and the content staying publicly reachable. The filter has to
// be present on EVERY public read, and the failure mode is silent: forget it
// in one new query and removed content is served as if nothing happened, with
// no error and no test failure anywhere else.
//
// So this test reads the source itself. For every `.from("studio_tracks")`
// query that is gated on `.eq("status", "published")` — which is how this
// codebase marks a read as public-facing — it asserts that the moderation
// filter is applied too.
//
// Owner-facing and admin-facing reads are intentionally NOT required to carry
// the filter: an artist must still see their own removed track (that is how
// they learn it was taken down and can file a counter-notice), and an admin
// must see removed content in order to review or reinstate it. Those reads are
// not gated on status = published, so they fall out of scope naturally rather
// than needing an allowlist.
//
// Pure file I/O, no DB and no network, matching the rest of scripts/*.test.ts.
//
// Run:  npx tsx scripts/studio-tracks-moderation.test.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const MODERATION_FILTER = '.eq("moderation_status", "clean")';
const PUBLISHED_FILTER = '.eq("status", "published")';

let failures = 0;
let checks = 0;

function fail(msg: string) {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

function pass(msg: string) {
  console.log(`  ok    ${msg}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Slice the source into individual query chains starting at .from("studio_tracks").
// A chain ends at the first `;` that terminates the await/assignment, which is
// good enough for this codebase's formatting and errs toward including MORE
// text (so a filter placed anywhere in the chain still counts).
function extractQueries(src: string): string[] {
  const chunks: string[] = [];
  let idx = src.indexOf('.from("studio_tracks")');
  while (idx !== -1) {
    const end = src.indexOf(";", idx);
    chunks.push(src.slice(idx, end === -1 ? src.length : end + 1));
    idx = src.indexOf('.from("studio_tracks")', idx + 1);
  }
  return chunks;
}

console.log("\nstudio_tracks public reads must filter moderation_status\n");

const files = walk(SRC);
let publicReadCount = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes('.from("studio_tracks")')) continue;
  const rel = relative(ROOT, file);

  for (const q of extractQueries(src)) {
    // Only public reads are in scope.
    if (!q.includes(PUBLISHED_FILTER)) continue;
    publicReadCount++;
    checks++;
    if (q.includes(MODERATION_FILTER)) {
      pass(`${rel} — public read filters moderation_status`);
    } else {
      fail(
        `${rel} — public studio_tracks read is gated on status="published" ` +
          `but does NOT filter moderation_status. Taken-down content would ` +
          `stay reachable. Add ${MODERATION_FILTER} to the chain:\n` +
          q.split("\n").slice(0, 6).map((l) => `          ${l.trim()}`).join("\n"),
      );
    }
  }
}

// Sanity check: if this drops to zero the scanner has silently stopped
// matching (a formatting change, a helper refactor) and would "pass" while
// checking nothing at all.
checks++;
if (publicReadCount >= 8) {
  pass(`scanner found ${publicReadCount} public studio_tracks reads`);
} else {
  fail(
    `scanner only found ${publicReadCount} public studio_tracks reads (expected >= 8). ` +
      `The detection pattern has probably drifted — fix the scanner, do not lower this number.`,
  );
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED\n` : "\n"),
);
process.exit(failures ? 1 : 0);
