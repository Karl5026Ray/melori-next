/* eslint-disable no-console */
// scripts/artist-books-front-door.test.ts
//
// Pins the 16 Nov 2026 review fixes on the artist page and /books:
//   • Start here pins expire on their date (Christmas with KRP leaves Jan 1).
//   • Pin keys are real CatalogItem key shapes.
//   • "Support" points off-site — Melori takes no money (Karl, 8 Sep 2026).
//   • The artist page and /books actually render the new pieces (wiring).
//   • /books never claims "every book pairs with a song" (it isn't true).
//
// Run:  npx tsx scripts/artist-books-front-door.test.ts

import fs from "node:fs";
import path from "node:path";

let checks = 0;
let failures = 0;
const check = (cond: boolean, l: string) => {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${l}`);
};
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

async function main() {
  const { ARTIST_FRONT_DOORS, activePins } = await import("../src/lib/artistFrontDoor");
  const karl = ARTIST_FRONT_DOORS["karl-ray"];
  check(Boolean(karl), "karl-ray has a front door");

  const dec = activePins(karl, new Date("2026-12-20T12:00:00Z")).map((p) => p.key);
  const jan = activePins(karl, new Date("2027-01-02T12:00:00Z")).map((p) => p.key);
  check(dec[0] === "release:26", "Christmas with KRP leads in December");
  check(!jan.includes("release:26"), "Christmas with KRP is gone in January");
  check(jan.length === karl.startHere.length - 1, "only the seasonal pin drops");

  const keyShape = /^(release:\d+|studio_album:[0-9a-f-]{36}|studio_track:[0-9a-f-]{36})$/;
  check(karl.startHere.every((p) => keyShape.test(p.key)), "every pin key is a CatalogItem key");
  check(Boolean(karl.support && /^https:\/\//.test(karl.support.href) && !/melori/.test(karl.support.href)), "support link goes off-site");

  const artistPage = read("src/app/artists/[slug]/page.tsx");
  for (const id of ["artist-start-here", "artist-links", "artist-support"]) {
    check(artistPage.includes(`data-testid="${id}"`), `artist page renders ${id}`);
  }
  check(/activePins\(frontDoor\)/.test(artistPage), "artist page uses activePins (seasonal expiry)");

  const books = read("src/app/books/page.tsx");
  check(/book\.blurb/.test(books), "/books renders blurbs");
  check(/<StandaloneCard/.test(books), "/books gives single titles a described card");
  check(books.includes('data-testid="books-listen"') && books.includes('data-testid="books-seasonal"'), "/books renders listen + seasonal notes");
  check(/export const revalidate = \d+/.test(books) && !/force-dynamic/.test(books), "/books is ISR, not force-dynamic");

  const lib = read("src/lib/books.ts");
  check(!/every book pairs|each book pairs|pairs with a song/i.test(lib + books), "no false 'every book pairs with a song' claim");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
