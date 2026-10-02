/* eslint-disable no-console */
// scripts/toolkit.test.ts
//
// Pins the Artist Toolkit's affiliate rules (src/lib/toolkit.ts):
//   • only enabled entries with an absolute https URL render;
//   • affiliate links carry rel="sponsored" (FTC + search-engine guidance);
//   • DistroKid stays hidden until its program approves Karl;
//   • the disclosure text is present and names commissions;
//   • the component actually uses the helpers (wiring, not just the helpers).
//
// Run:  npx tsx scripts/toolkit.test.ts

import { readFileSync } from "node:fs";
import {
  TOOLKIT_DISCLOSURE,
  TOOLKIT_ITEMS,
  toolkitRel,
  visibleToolkitItems,
} from "@/lib/toolkit";

let checks = 0;
let failures = 0;
const expect = (cond: boolean, label: string) => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}`); }
};

const visible = visibleToolkitItems();
expect(visible.length >= 1, "at least one tool is visible");
expect(visible.every((i) => i.url.startsWith("https://")), "every visible tool has an https URL");
expect(!visible.some((i) => i.id === "distrokid"), "DistroKid is hidden until approved");
expect(
  visibleToolkitItems([
    { id: "x", name: "X", category: "c", blurb: "b", url: "", affiliate: true, enabled: true },
  ]).length === 0,
  "an enabled entry with no URL is still hidden",
);
expect(
  TOOLKIT_ITEMS.filter((i) => i.affiliate).every((i) => toolkitRel(i).includes("sponsored")),
  "every affiliate link is rel=sponsored",
);
expect(/commission/i.test(TOOLKIT_DISCLOSURE), "disclosure mentions commission");

const component = readFileSync("src/components/toolkit/ToolkitLinks.tsx", "utf8");
expect(component.includes("visibleToolkitItems()"), "component renders visibleToolkitItems()");
expect(component.includes("rel={toolkitRel(item)}"), "component applies toolkitRel to links");
expect(component.includes("{TOOLKIT_DISCLOSURE}"), "component renders the disclosure");
expect(component.includes("getNativePlatform"), "component hides links in the native app");

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
