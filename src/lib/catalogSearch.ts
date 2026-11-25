// Catalog search matching for the /music page (and any other catalog grid).
//
// The old filter only looked at the release title and the artist name, as one
// exact lowercase substring. That missed the searches people actually type:
//   * a song title that lives inside an album ("Champion" on BINO)
//   * a genre ("gospel", "r&b")
//   * punctuation and accent differences ("dont" vs "Don't", "Beyonce" vs
//     "Beyoncé", "rnb" vs "R&B")
//   * words out of order or spread across fields ("karl woe")
//
// Pure functions only, so they can run in the client component and be pinned
// by scripts/catalog-search.test.ts.

export interface SearchableCatalogItem {
  title: string;
  artist?: { name: string } | null;
  genre?: string | null;
  trackTitles?: string[];
}

/** Lowercase, strip accents, drop punctuation, collapse whitespace. "&" and
 *  "and" both become "and" so "R&B", "R and B" and "rnb" can meet. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Same text with every space removed, so "rnb" can match "r and b" squeezed
 *  ("randb") and "hiphop" matches "hip hop". */
function squeeze(text: string): string {
  return text.replace(/ /g, "").replace(/and/g, "n");
}

/** Everything a visitor might search an item by, normalized once. */
export function searchHaystack(item: SearchableCatalogItem): string {
  return normalizeSearchText(
    [
      item.title,
      item.artist?.name ?? "",
      item.genre ?? "",
      ...(item.trackTitles ?? []),
    ].join(" | "),
  );
}

/**
 * True when every word of the query appears somewhere in the item's title,
 * artist, genre or track titles. An empty query matches everything.
 */
export function matchesCatalogQuery(
  item: SearchableCatalogItem,
  rawQuery: string,
  haystack: string = searchHaystack(item),
): boolean {
  const query = normalizeSearchText(rawQuery);
  if (query === "") return true;

  const squeezedHaystack = squeeze(haystack);
  // Whole-phrase hit first (covers "rnb" vs "R&B" and "hiphop" vs "Hip-Hop").
  if (squeezedHaystack.includes(squeeze(query))) return true;

  return query
    .split(" ")
    .every(
      (word) => haystack.includes(word) || squeezedHaystack.includes(squeeze(word)),
    );
}
