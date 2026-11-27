/* eslint-disable no-console */
// scripts/catalog-search.test.ts
//
// Pins what the /music search box finds. Before this, it only matched the
// release title or the artist name as one exact substring, so searching a song
// inside an album, a genre, or a name with different punctuation found nothing.
//
// Run:  npx tsx scripts/catalog-search.test.ts

import {
  matchesCatalogQuery,
  normalizeSearchText,
} from "@/lib/catalogSearch";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const bino = {
  title: "BINO - Peace Over Ego",
  artist: { name: "Karl Ray" },
  genre: "Hip-Hop",
  trackTitles: ["Champion", "Don't Look Back"],
};
const gloria = {
  title: "Glory in My Rivers",
  artist: { name: "Gloria Joy Rivers" },
  genre: "R&B",
  trackTitles: ["Blessed Be Your Name"],
};
const beyonca = { title: "Café Nights", artist: { name: "Beyoncé J" }, genre: null };

console.log("catalog search");
check("empty query matches", matchesCatalogQuery(bino, ""), true);
check("release title", matchesCatalogQuery(bino, "peace over"), true);
check("artist name", matchesCatalogQuery(bino, "karl"), true);
check("song inside an album", matchesCatalogQuery(bino, "champion"), true);
check("song title is case-insensitive", matchesCatalogQuery(bino, "CHAMPION"), true);
check("apostrophe optional", matchesCatalogQuery(bino, "dont look"), true);
check("genre", matchesCatalogQuery(gloria, "r&b"), true);
check("rnb finds R&B", matchesCatalogQuery(gloria, "rnb"), true);
check("hiphop finds Hip-Hop", matchesCatalogQuery(bino, "hiphop"), true);
check("words across fields", matchesCatalogQuery(bino, "karl champion"), true);
check("words in any order", matchesCatalogQuery(gloria, "rivers glory"), true);
check("accents optional", matchesCatalogQuery(beyonca, "beyonce cafe"), true);
check("no false match", matchesCatalogQuery(bino, "gospel"), false);
check("all words must match", matchesCatalogQuery(bino, "karl gospel"), false);
check("item without tracks still works", matchesCatalogQuery(beyonca, "nights"), true);
const kaiel = { title: "KAEL - REMADE", artist: { name: "Kaiel R" }, genre: "R&B", trackTitles: ["Summer Days", "Impossibly"] };
check("one typo in a name", matchesCatalogQuery(kaiel, "kiel"), true);
check("dropped letter", matchesCatalogQuery(gloria, "glora"), true);
check("swapped letters", matchesCatalogQuery(gloria, "gloira"), true);
check("typo in a song title", matchesCatalogQuery(kaiel, "imposibly"), true);
check("two typos in a long word", matchesCatalogQuery(bino, "champoinn"), true);
check("half-typed word with a typo", matchesCatalogQuery(gloria, "glroi"), true);
check("short words get no typo pass", matchesCatalogQuery(gloria, "rap"), false);
check("typo tolerance has limits", matchesCatalogQuery(bino, "gospel"), false);
check("unrelated word still misses", matchesCatalogQuery(kaiel, "winter"), false);
check("normalize punctuation", normalizeSearchText("  Don't-Stop   ME!! "), "dont stop me");

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
