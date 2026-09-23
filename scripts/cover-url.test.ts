/* eslint-disable no-console */
//
// scripts/cover-url.test.ts
//
// Guards the cover_url validation used by click-to-replace covers:
//   - PATCH /api/studio/track/[id]        (artist, own folder only)
//   - PATCH /api/admin/studio-tracks/[id] (admin, any covers object)
// plus source checks that both routes actually call the validator and the
// shared-cover-safe delete, so a refactor can't silently drop them.
//
// Pure, no DB / network. Run: npx tsx scripts/cover-url.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coverPathFromUrl, isAllowedCoverUrl } from "../src/lib/cover-url";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}
function run(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

const BASE = "https://proj.supabase.co";
const ME = "ad930dea-5192-48ed-b4ae-cfeefd43e01f";
const OTHER = "11111111-2222-3333-4444-555555555555";
const pub = (path: string, base = BASE, bucket = "covers") =>
  `${base}/storage/v1/object/public/${bucket}/${path}`;

run("coverPathFromUrl", () => {
  check("studio path", coverPathFromUrl(pub(`studio/${ME}/1_a.jpg`)), `studio/${ME}/1_a.jpg`);
  check("admin root path", coverPathFromUrl(pub("1790_cover.png")), "1790_cover.png");
  check("strips cache-buster", coverPathFromUrl(pub("x.jpg") + "?v=2"), "x.jpg");
  check("decodes spaces", coverPathFromUrl(pub("my%20cover.jpg")), "my cover.jpg");
  check("other bucket", coverPathFromUrl(pub("x.mp3", BASE, "audio-files")), null);
  check("traversal", coverPathFromUrl(pub("studio/../secret.jpg")), null);
  check("encoded traversal", coverPathFromUrl(pub("studio/%2e%2e/secret.jpg")), null);
  check("empty path", coverPathFromUrl(pub("")), null);
  check("not a string", coverPathFromUrl(42), null);
  check("random url", coverPathFromUrl("https://evil.example/cover.jpg"), null);
});

run("isAllowedCoverUrl — artist (own folder)", () => {
  const rules = { supabaseUrl: BASE, ownerId: ME };
  check("own folder ok", isAllowedCoverUrl(pub(`studio/${ME}/1_a.jpg`), rules), true);
  check("trailing slash on base ok", isAllowedCoverUrl(pub(`studio/${ME}/1_a.jpg`), { ...rules, supabaseUrl: BASE + "/" }), true);
  check("another artist rejected", isAllowedCoverUrl(pub(`studio/${OTHER}/1_a.jpg`), rules), false);
  check("prefix trick rejected", isAllowedCoverUrl(pub(`studio/${ME}x/1_a.jpg`), rules), false);
  check("admin root object rejected", isAllowedCoverUrl(pub("1790_cover.png"), rules), false);
  check("other project rejected", isAllowedCoverUrl(pub(`studio/${ME}/1_a.jpg`, "https://other.supabase.co"), rules), false);
  check("audio bucket rejected", isAllowedCoverUrl(pub(`studio/${ME}/1_a.mp3`, BASE, "audio-files"), rules), false);
  check("null owner rejected", isAllowedCoverUrl(pub(`studio/${ME}/1_a.jpg`), { supabaseUrl: BASE, ownerId: null }), false);
  check("null value rejected", isAllowedCoverUrl(null, rules), false);
});

run("isAllowedCoverUrl — admin (any covers object)", () => {
  const rules = { supabaseUrl: BASE };
  check("admin root object ok", isAllowedCoverUrl(pub("1790_cover.png"), rules), true);
  check("any artist folder ok", isAllowedCoverUrl(pub(`studio/${OTHER}/1_a.jpg`), rules), true);
  check("other project rejected", isAllowedCoverUrl(pub("x.png", "https://other.supabase.co"), rules), false);
  check("other bucket rejected", isAllowedCoverUrl(pub("x.png", BASE, "avatars"), rules), false);
});

run("routes are wired to the validator and the shared-cover-safe delete", () => {
  const root = join(__dirname, "..");
  const studio = readFileSync(join(root, "src/app/api/studio/track/[id]/route.ts"), "utf8");
  const admin = readFileSync(join(root, "src/app/api/admin/studio-tracks/[id]/route.ts"), "utf8");
  check("studio PATCH validates cover_url with ownerId", /isAllowedCoverUrl\(body\.cover_url,[\s\S]{0,160}ownerId: userId/.test(studio), true);
  check("studio PATCH uses removeCoverIfUnreferenced", studio.includes("removeCoverIfUnreferenced("), true);
  check("admin PATCH validates cover_url", /isAllowedCoverUrl\(body\.cover_url/.test(admin), true);
  check("admin PATCH uses removeCoverIfUnreferenced", admin.includes("removeCoverIfUnreferenced("), true);
  check("studio DELETE keeps shared covers", /DELETE[\s\S]*removeCoverIfUnreferenced\(supabase, row\.cover_url\)/.test(studio), true);
  check("admin DELETE keeps shared covers", /DELETE[\s\S]*removeCoverIfUnreferenced\(supabase, row\.cover_url\)/.test(admin), true);
  check("no unconditional covers remove left", !/from\("covers"\)\.remove/.test(studio + admin), true);
  const list = readFileSync(join(root, "src/app/api/studio/tracks/route.ts"), "utf8");
  check("studio GET selects cover_url", /select\(\s*"[^"]*\bcover_url\b/.test(list), true);
  const covers = readFileSync(join(root, "src/lib/studio-covers.ts"), "utf8");
  check("delete checks studio_tracks references", covers.includes('table: "studio_tracks"'), true);
  check("delete keeps file when lookup fails", covers.includes('"kept:lookup-failed"'), true);
});

console.log(failures ? `\n${failures} failure(s)` : "\nAll cover-url checks passed.");
process.exit(failures ? 1 : 0);
