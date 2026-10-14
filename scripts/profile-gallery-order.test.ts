/* eslint-disable no-console */
// scripts/profile-gallery-order.test.ts
//
// Pins the pure logic behind the owner's profile Photos editor
// (src/components/social/ProfileGalleryEditor.tsx): touch-friendly moves,
// Replace keeping the old tile's position, and multi-select upload planning
// against the 20-slot limit. Also pins the WIRING: ProfileTabs must render the
// editor for the owner, and settings must not carry a second gallery.
//
// Run:  npx tsx scripts/profile-gallery-order.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  moveItem,
  planUploads,
  replaceOrder,
  GALLERY_MAX_IMAGE_BYTES,
} from "@/lib/profileGalleryOrder";

let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown) {
  const a = JSON.stringify(actual);
  const w = JSON.stringify(wanted);
  if (a === w) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}\n        got    ${a}\n        wanted ${w}`); }
}

console.log("moveItem");
const abc = ["a", "b", "c", "d"];
expect("make first", moveItem(abc, 2, 0), ["c", "a", "b", "d"]);
expect("move left", moveItem(abc, 1, 0), ["b", "a", "c", "d"]);
expect("move right", moveItem(abc, 1, 2), ["a", "c", "b", "d"]);
expect("last to first", moveItem(abc, 3, 0), ["d", "a", "b", "c"]);
expect("no-op keeps reference", moveItem(abc, 1, 1) === abc, true);
expect("out of range keeps reference", moveItem(abc, 0, 9) === abc, true);
expect("negative keeps reference", moveItem(abc, -1, 0) === abc, true);
expect("input not mutated", abc, ["a", "b", "c", "d"]);

console.log("replaceOrder");
expect("new takes old slot, old goes last", replaceOrder(["a", "b", "c"], "b", "n"), ["a", "n", "c", "b"]);
expect("new already appended", replaceOrder(["a", "b", "c", "n"], "a", "n"), ["n", "b", "c", "a"]);
expect("replace last", replaceOrder(["a", "b"], "b", "n"), ["a", "n", "b"]);
expect("unknown old id appends new", replaceOrder(["a"], "zz", "n"), ["a", "n"]);

console.log("planUploads");
const img = (name: string, size = 1000) => ({ name, type: "image/jpeg", size });
const r1 = planUploads([img("1"), img("2"), img("3")], 2);
expect("accepts up to remaining", r1.accepted.map((f) => f.name), ["1", "2"]);
expect("skips the rest as over_limit", r1.skipped.map((s) => [s.file.name, s.reason]), [["3", "over_limit"]]);
const r2 = planUploads([img("big", GALLERY_MAX_IMAGE_BYTES + 1), { name: "doc", type: "application/pdf", size: 1 }, img("ok")], 1);
expect("too big and wrong type do not use a slot", r2.accepted.map((f) => f.name), ["ok"]);
expect("reasons", r2.skipped.map((s) => s.reason), ["too_big", "type"]);
expect("video up to 60MB ok", planUploads([{ name: "v", type: "video/mp4", size: 50 * 1024 * 1024 }], 1).accepted.length, 1);
expect("full gallery accepts none", planUploads([img("x")], 0).accepted.length, 0);
expect("negative remaining treated as 0", planUploads([img("x")], -3).skipped[0].reason, "over_limit");

console.log("wiring");
const root = join(__dirname, "..");
const tabs = readFileSync(join(root, "src/components/social/profile/ProfileTabs.tsx"), "utf8");
expect("ProfileTabs imports the editor", tabs.includes('from "@/components/social/ProfileGalleryEditor"'), true);
expect("owner photos tab renders editor", /if \(isOwner\)\s*\{\s*return <ProfileGalleryEditor onChanged=/.test(tabs), true);
const editor = readFileSync(join(root, "src/components/social/ProfileGalleryEditor.tsx"), "utf8");
expect("editor input is multiple", /type="file"[\s\S]{0,80}multiple/.test(editor), true);
expect("editor uses replaceOrder", editor.includes("replaceOrder("), true);
expect("editor uses moveItem", editor.includes("moveItem("), true);
expect("editor uses planUploads", editor.includes("planUploads("), true);
const settings = readFileSync(join(root, "src/app/settings/page.tsx"), "utf8");
expect("settings has no MAX_GALLERY", settings.includes("MAX_GALLERY"), false);
expect("settings has no gallery upload", settings.includes("/api/user/gallery"), false);
expect("settings links to profile", settings.includes('href="/social/profile"'), true);
const route = readFileSync(join(root, "src/app/api/user/gallery/route.ts"), "utf8");
expect("server limit stays 20", /const MAX_SLOTS = 20;/.test(route), true);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall profile-gallery checks passed");
