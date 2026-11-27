/* eslint-disable no-console */
// scripts/site-search.test.ts
//
// Pins what the sitewide search (/search) finds and in what order.
//
// Run:  npx tsx scripts/site-search.test.ts

import { groupHits, makeEntry, searchSite } from "@/lib/siteSearch";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const entries = [
  makeEntry({ key: "artist:1", kind: "artist", title: "Kaiel R", subtitle: "Artist", href: "/artists/kaiel-r", image: null }),
  makeEntry({ key: "artist:2", kind: "artist", title: "Gloria Joy Rivers", subtitle: "Artist", href: "/artists/gloria", image: null }),
  makeEntry({
    key: "release:1", kind: "music", title: "KAEL - REMADE", subtitle: "Kaiel R · Album",
    href: "/albums/kael-remade", image: null, songs: ["Summer Days", "Impossibly"], extra: ["R&B"],
  }),
  makeEntry({ key: "release:2", kind: "music", title: "Glory in My Rivers", subtitle: "Gloria Joy Rivers · Album", href: "/albums/glory", image: null }),
  makeEntry({ key: "book:1", kind: "book", title: "Pip and the Big Beat", subtitle: "Book · The Melori Band", href: "https://example.com", external: true, image: null, extra: ["The Melori Band", "book books"] }),
  makeEntry({ key: "show:1", kind: "show", title: "Melori Radio Hour 1", subtitle: "Karl Ray · Radio show", href: "/music/x", image: null }),
];

console.log("site search");
check("empty query finds nothing", searchSite(entries, "  ").length, 0);
check("artist by name", searchSite(entries, "kaiel")[0]?.key, "artist:1");
check("artist ranks above their album", searchSite(entries, "kaiel")[1]?.key, "release:1");
check("typo still finds the artist", searchSite(entries, "kiel")[0]?.key, "artist:1");
check("song inside an album", searchSite(entries, "summer days")[0]?.key, "release:1");
check("song hit says which song", searchSite(entries, "summer days")[0]?.matchedSong, "Summer Days");
check("title hit carries no song note", searchSite(entries, "remade")[0]?.matchedSong, undefined);
check("books by series", searchSite(entries, "melori band")[0]?.key, "book:1");
check("the word book finds books", searchSite(entries, "book").some((h) => h.key === "book:1"), true);
check("radio shows are searchable", searchSite(entries, "radio hour")[0]?.key, "show:1");
check("genre search", searchSite(entries, "rnb")[0]?.key, "release:1");
check("no match is empty", searchSite(entries, "zzzzzz").length, 0);
check("exact title beats a mention", searchSite(entries, "glory in my rivers")[0]?.key, "release:2");

const groups = groupHits(searchSite(entries, "rivers"));
check("groups in section order", groups.map((g) => g.kind).join(","), "artist,music");
check("empty sections dropped", groups.every((g) => g.hits.length > 0), true);

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
