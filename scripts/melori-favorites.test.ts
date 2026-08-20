/* eslint-disable no-console */
//
// scripts/melori-favorites.test.ts
//
// VALIDATION TESTS for the homepage "Melori Favorites" ordering
// (sortMeloriFavorites in src/lib/releaseSort.ts).
//
// The row is the first thing a visitor sees, and it is sliced to 12, so the
// ordering decides what the platform looks like it is about. The contract:
//
//   * ALBUMS LEAD. Every album outranks every single/EP, regardless of date.
//   * Albums are ranked by LIFETIME PLAYS across their tracks, descending.
//   * Albums tied on plays (all of them, at zero) keep NEWEST-FIRST order —
//     the row must not reshuffle between renders.
//   * Singles/EPs follow in newest-first order.
//   * An album with no play data sorts to the back of the album block, never
//     out of the row: a new artist's album stays visible with zero plays.
//   * The input array is never mutated.
//
// Pure function, no DB / no network, so it is deterministic and fast.
//
// Run:  npx tsx scripts/melori-favorites.test.ts  (also: npm run test:favorites)

import {
  sortMeloriFavorites,
  totalPlays,
  type FavoritesItem,
} from "@/lib/releaseSort";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function group(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// Minimal builder — only the fields the sort reads.
function item(
  title: string,
  release_type: FavoritesItem["release_type"],
  release_date: string | null,
  plays?: number[],
): FavoritesItem {
  const trackPlayCounts =
    plays === undefined
      ? undefined
      : Object.fromEntries(plays.map((n, i) => [i + 1, n]));
  return {
    title,
    release_type,
    release_date,
    artist: { name: "Test Artist" },
    ...(trackPlayCounts ? { trackPlayCounts } : {}),
  };
}

const titles = (items: FavoritesItem[]) => items.map((i) => i.title);

group("totalPlays", () => {
  assertEq("sums every track", totalPlays(item("x", "album", null, [3, 4, 5])), 12);
  assertEq("missing map is zero", totalPlays(item("x", "album", null)), 0);
  assertEq("empty map is zero", totalPlays(item("x", "album", null, [])), 0);
  assertEq(
    "ignores negative and non-finite values",
    totalPlays({ trackPlayCounts: { 1: 10, 2: -5, 3: NaN, 4: Infinity } }),
    10,
  );
});

group("albums lead the row", () => {
  // The single is far newer than the album; the album must still win.
  const sorted = sortMeloriFavorites([
    item("Fresh Single", "single", "2026-08-01", [999]),
    item("Old Album", "album", "2020-01-01", [1]),
  ]);
  assertEq("album outranks a newer single", titles(sorted), [
    "Old Album",
    "Fresh Single",
  ]);

  const withEp = sortMeloriFavorites([
    item("An EP", "ep", "2026-08-01", [500]),
    item("An Album", "album", "2019-01-01"),
  ]);
  assertEq("an EP does not count as an album", titles(withEp), [
    "An Album",
    "An EP",
  ]);
});

group("albums rank by lifetime plays", () => {
  const sorted = sortMeloriFavorites([
    item("Quiet", "album", "2026-01-01", [1, 1]),
    item("Loudest", "album", "2020-01-01", [400, 600]),
    item("Middle", "album", "2025-01-01", [50, 50, 50]),
  ]);
  assertEq("most-played first, oldest date irrelevant", titles(sorted), [
    "Loudest",
    "Middle",
    "Quiet",
  ]);
});

group("ties keep newest-first (stability)", () => {
  const input = [
    item("Older Zero", "album", "2024-01-01"),
    item("Newest Zero", "album", "2026-05-01"),
    item("Middle Zero", "album", "2025-01-01"),
  ];
  const sorted = sortMeloriFavorites(input);
  assertEq("all-zero albums fall back to release date", titles(sorted), [
    "Newest Zero",
    "Middle Zero",
    "Older Zero",
  ]);
  // Re-sorting the already-sorted output must be a no-op, or the homepage
  // would reorder itself on every render.
  assertEq(
    "ordering is idempotent",
    titles(sortMeloriFavorites(sorted)),
    titles(sorted),
  );
});

group("zero-play albums stay in the row", () => {
  const sorted = sortMeloriFavorites([
    item("Popular Album", "album", "2020-01-01", [100]),
    item("Brand New Album", "album", "2026-08-01"),
    item("A Single", "single", "2026-08-02", [5000]),
  ]);
  assertEq("no-play album still beats every single", titles(sorted), [
    "Popular Album",
    "Brand New Album",
    "A Single",
  ]);
});

group("singles keep newest-first", () => {
  const sorted = sortMeloriFavorites([
    item("Single Old", "single", "2024-01-01", [900]),
    item("Single New", "single", "2026-07-01", [1]),
    item("Single Undated", "single", null, [50]),
  ]);
  assertEq("newest first, undated last", titles(sorted), [
    "Single New",
    "Single Old",
    "Single Undated",
  ]);
});

group("purity", () => {
  const input = [
    item("B Single", "single", "2026-01-01"),
    item("A Album", "album", "2020-01-01", [10]),
  ];
  const before = titles(input);
  sortMeloriFavorites(input);
  assertEq("input array is not mutated", titles(input), before);
  assertEq("empty input is safe", sortMeloriFavorites([]), []);
});

console.log(
  failures === 0
    ? "\nAll Melori Favorites ordering tests passed."
    : `\n${failures} Melori Favorites ordering test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
