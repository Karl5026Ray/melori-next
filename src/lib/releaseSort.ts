// Type-only imports are erased at build time, so this module stays
// client-safe (it never pulls in the server-only admin client).

// Sort options shared by the /music catalog and artist discography.
// Default is newest first (most recent releases surface at the top).
export type ReleaseSort = "release_date" | "alpha" | "artist";

// The minimum shape the sort needs. Generic over the concrete item type so the
// same comparators serve legacy releases and artist self-uploads — both flow
// through the unified catalog now.
export interface SortableItem {
  title: string;
  release_date: string | null;
  artist: { name: string } | null;
}

// The first entry is the default sort used across the catalog and discography.
export const DEFAULT_RELEASE_SORT: ReleaseSort = "release_date";

export const RELEASE_SORT_OPTIONS: { value: ReleaseSort; label: string }[] = [
  { value: "release_date", label: "Newest" },
  { value: "alpha", label: "Alphabetical" },
  { value: "artist", label: "Artist name" },
];

const byTitle = (a: SortableItem, b: SortableItem) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

// The extra shape the homepage "Melori Favorites" ordering needs on top of
// SortableItem. Both fields already exist on CatalogItem; kept structural here
// so this module stays free of the server-only catalog import.
export interface FavoritesItem extends SortableItem {
  release_type: "album" | "single" | "ep";
  trackPlayCounts?: Record<number, number>;
}

// Lifetime plays summed across every track on one catalog item. Missing,
// negative and non-finite values count as zero so a bad row can never drag an
// item above or below the rest of the row.
export function totalPlays(item: {
  trackPlayCounts?: Record<number, number>;
}): number {
  let total = 0;
  for (const n of Object.values(item.trackPlayCounts ?? {})) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

// Homepage "Melori Favorites" ordering.
//
// Albums lead the row, ranked by lifetime plays across their tracks — the row
// should read as what listeners actually come back to, not as a changelog of
// whatever was uploaded last. Singles and EPs follow, keeping the newest-first
// order, so a fresh upload still surfaces once the albums are exhausted.
//
// Self-uploaded studio items carry no play-count map today and therefore total
// zero. They sort to the BACK of the album block rather than being dropped, so
// a new artist album is never invisible purely for having no plays yet.
//
// Both groups are seeded from the newest-first sort, and Array#sort is stable,
// so albums tied on plays (very common at zero) stay in release-date order
// instead of shuffling between renders.
export function sortMeloriFavorites<T extends FavoritesItem>(items: T[]): T[] {
  const newestFirst = sortReleases(items, "release_date");
  const albums: T[] = [];
  const rest: T[] = [];
  for (const item of newestFirst) {
    if (item.release_type === "album") albums.push(item);
    else rest.push(item);
  }
  albums.sort((a, b) => totalPlays(b) - totalPlays(a));
  return [...albums, ...rest];
}

// Returns a new sorted array; never mutates the input.
export function sortReleases<T extends SortableItem>(
  releases: T[],
  sort: ReleaseSort,
): T[] {
  const copy = [...releases];
  switch (sort) {
    case "release_date":
      // Newest first; releases with no date sort last.
      return copy.sort((a, b) => {
        if (!a.release_date && !b.release_date) return byTitle(a, b);
        if (!a.release_date) return 1;
        if (!b.release_date) return -1;
        return b.release_date.localeCompare(a.release_date);
      });
    case "artist":
      // Artist name A→Z (null artist last), tie-break by title.
      return copy.sort((a, b) => {
        const an = a.artist?.name ?? null;
        const bn = b.artist?.name ?? null;
        if (!an && !bn) return byTitle(a, b);
        if (!an) return 1;
        if (!bn) return -1;
        const cmp = an.localeCompare(bn, undefined, { sensitivity: "base" });
        return cmp !== 0 ? cmp : byTitle(a, b);
      });
    case "alpha":
    default:
      return copy.sort(byTitle);
  }
}
