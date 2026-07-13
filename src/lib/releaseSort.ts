import type { ReleaseListItem } from "@/lib/data";

// Type-only import above is erased at build time, so this module stays
// client-safe (it never pulls in the server-only admin client).

// Sort options shared by the /music catalog and artist discography.
// Default is newest first (most recent releases surface at the top).
export type ReleaseSort = "release_date" | "alpha" | "artist";

// The first entry is the default sort used across the catalog and discography.
export const DEFAULT_RELEASE_SORT: ReleaseSort = "release_date";

export const RELEASE_SORT_OPTIONS: { value: ReleaseSort; label: string }[] = [
  { value: "release_date", label: "Newest" },
  { value: "alpha", label: "Alphabetical" },
  { value: "artist", label: "Artist name" },
];

const byTitle = (a: ReleaseListItem, b: ReleaseListItem) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

// Returns a new sorted array; never mutates the input.
export function sortReleases(
  releases: ReleaseListItem[],
  sort: ReleaseSort,
): ReleaseListItem[] {
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
