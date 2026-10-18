/* eslint-disable no-console */
// scripts/gallery-credit.test.ts
//
// Pins the melorimusic.org credit on public full-res downloads
// (src/lib/gallery-credit.ts). Karl, 18 Oct 2026: downloads should carry the
// site address "to let people know where it came from". The credited copy is
// cached beside the original, so its key must never be the original's key
// (that would stamp his master file), and the pill must stay inside the frame.
//
// Run:  npx tsx scripts/gallery-credit.test.ts

import { CREDIT_TEXT, creditKeyFor, creditOverlaySvg } from "@/lib/gallery-credit";

let checks = 0;
let failures = 0;
const check = (cond: boolean, label: string) => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}`); }
};

const orig = "owner/gallery/1111/original.jpg";
check(creditKeyFor(orig) === "owner/gallery/1111/download.jpg", "original.jpg → download.jpg beside it");
check(creditKeyFor("legacy/key/photo.jpeg") === "legacy/key/photo.jpeg.credit.jpg", "odd keys get a suffix");
for (const k of [orig, "a/b.jpg", "x/original.jpg.bak"]) {
  check(creditKeyFor(k) !== k, `credited key never overwrites the original (${k})`);
}

function box(svg: string) {
  const m = svg.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
  return m ? m.slice(1).map(Number) : null;
}
for (const [w, h] of [[6000, 4000], [4000, 6000], [800, 1200], [300, 200]]) {
  const svg = creditOverlaySvg(w, h);
  const b = box(svg);
  check(svg.includes(CREDIT_TEXT), `${w}x${h}: says ${CREDIT_TEXT}`);
  check(!!b && b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= w && b[1] + b[3] <= h, `${w}x${h}: pill inside the frame`);
  check(!!b && b[0] + b[2] > w * 0.9 && b[1] + b[3] > h * 0.85, `${w}x${h}: pill sits bottom-right`);
}
const big = box(creditOverlaySvg(6000, 4000))!;
check(big[3] < 4000 * 0.06, "pill stays small on a big file (< 6% of height)");

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
