/* eslint-disable no-console */
//
// scripts/description-links.test.ts
//
// Guards the linkifier Mirror uses for post descriptions, plus a source check
// that VideoCard actually renders through it.
//
// Pure, no DB / network. Run: npx tsx scripts/description-links.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { descriptionSegments } from "../src/lib/descriptionLinks";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}\n      got:      ${a}\n      expected: ${e}`);
  }
}

check("empty", descriptionSegments(null), []);
check("plain text", descriptionSegments("hello"), [{ kind: "text", text: "hello" }]);

check(
  "bare melorimusic.org path becomes an internal link",
  descriptionSegments("📚 Books: melorimusic.org/books"),
  [
    { kind: "text", text: "📚 Books: " },
    { kind: "link", text: "melorimusic.org/books", href: "/books", internal: true },
  ],
);

check(
  "trailing period stays text",
  descriptionSegments("Get them at https://melorimusic.org/books."),
  [
    { kind: "text", text: "Get them at " },
    { kind: "link", text: "https://melorimusic.org/books", href: "/books", internal: true },
    { kind: "text", text: "." },
  ],
);

check(
  "external https link opens as absolute URL",
  descriptionSegments("see https://example.com/x"),
  [
    { kind: "text", text: "see " },
    { kind: "link", text: "https://example.com/x", href: "https://example.com/x", internal: false },
  ],
);

check(
  "javascript: is never a link",
  descriptionSegments("javascript:alert(1)"),
  [{ kind: "text", text: "javascript:alert(1)" }],
);

const card = readFileSync(
  join(__dirname, "../src/components/social/video/VideoCard.tsx"),
  "utf8",
);
check("VideoCard renders descriptions through descriptionSegments", card.includes("descriptionSegments(video.description)"), true);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall description-link checks passed");
