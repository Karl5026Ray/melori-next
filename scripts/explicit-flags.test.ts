/* eslint-disable no-console */
// scripts/explicit-flags.test.ts
//
// Pins the explicit-content plumbing that is pure logic:
//   • which track refs a listener report accepts (studio uuid / legacy int),
//   • that the 'studio:<uuid>' / 'legacy:<int>' queue key round-trips,
//   • that auto-labeling stays OFF unless a threshold of 2+ is configured, so
//     a single listener can never relabel a track on their own.
//
// Run:  npx tsx scripts/explicit-flags.test.ts

import {
  autoMarkThreshold,
  parseTrackRef,
  trackRefFromKey,
  trackRefKey,
} from "@/lib/explicit-flags";

let checks = 0;
let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const w = JSON.stringify(wanted);
  if (a === w) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} — got ${a}, wanted ${w}`);
  }
}

const UUID = "3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b";

console.log("parseTrackRef");
expect("studio uuid", parseTrackRef("studio", UUID), { sourceType: "studio", id: UUID });
expect("studio non-uuid rejected", parseTrackRef("studio", "42"), null);
expect("legacy int", parseTrackRef("legacy", "42"), { sourceType: "legacy", id: 42 });
expect("legacy default when sourceType missing", parseTrackRef(undefined, 7), { sourceType: "legacy", id: 7 });
expect("legacy zero rejected", parseTrackRef("legacy", 0), null);
expect("legacy fraction rejected", parseTrackRef("legacy", "1.5"), null);
expect("unknown source rejected", parseTrackRef("video", UUID), null);

console.log("queue key round-trip");
expect("studio", trackRefFromKey(trackRefKey({ sourceType: "studio", id: UUID })), { sourceType: "studio", id: UUID });
expect("legacy", trackRefFromKey(trackRefKey({ sourceType: "legacy", id: 9 })), { sourceType: "legacy", id: 9 });
expect("garbage key", trackRefFromKey("nope"), null);

console.log("autoMarkThreshold");
const saved = process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD;
delete process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD;
expect("unset → off", autoMarkThreshold(), null);
process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD = "1";
expect("1 → off (one listener can't relabel)", autoMarkThreshold(), null);
process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD = "abc";
expect("non-number → off", autoMarkThreshold(), null);
process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD = "5";
expect("5 → 5", autoMarkThreshold(), 5);
if (saved === undefined) delete process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD;
else process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD = saved;

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
