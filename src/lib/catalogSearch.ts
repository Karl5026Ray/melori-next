// Catalog search matching for the /music page (and any other catalog grid).
//
// The old filter only looked at the release title and the artist name, as one
// exact lowercase substring. That missed the searches people actually type:
//   * a song title that lives inside an album ("Champion" on BINO)
//   * a genre ("gospel", "r&b")
//   * punctuation and accent differences ("dont" vs "Don't", "Beyonce" vs
//     "Beyoncé", "rnb" vs "R&B")
//   * words out of order or spread across fields ("karl woe")
//   * small typos ("kiel" for "Kaiel", "glora" for "Gloria") — Karl, 2026-11-27
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

/** How many typos a query word may carry and still count, by its length.
 *  Short words get none: "rap" must not match "pop". */
function allowedTypos(word: string): number {
  if (word.length >= 8) return 2;
  if (word.length >= 4) return 1;
  return 0;
}

/** Edit distance (insert, delete, substitute, swap two neighbours), stopping
 *  early once it passes `max`. Small and allocation-light: haystacks are short. */
export function editDistanceWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Does one query word appear in the haystack, allowing a typo or two?
 * Exact substring first (cheap), then each haystack word, and the start of
 * each haystack word, within the allowed edit distance — so "kiel" finds
 * "Kaiel" and "glora" finds "Gloria", and a half-typed "glor" still finds it.
 */
export function wordMatches(word: string, haystack: string): boolean {
  if (haystack.includes(word)) return true;
  const max = allowedTypos(word);
  if (max === 0) return false;
  for (const hay of haystack.split(" ")) {
    if (hay.length === 0) continue;
    if (editDistanceWithin(word, hay, max) <= max) return true;
    // Typed the start of a longer word with a typo ("glroia" -> "gloria joy").
    if (hay.length > word.length) {
      const head = hay.slice(0, word.length);
      if (editDistanceWithin(word, head, max) <= max) return true;
    }
  }
  return false;
}

/**
 * True when every word of the query appears somewhere in the item's title,
 * artist, genre or track titles, allowing small typos. An empty query matches
 * everything.
 */
export function matchesCatalogQuery(
  item: SearchableCatalogItem,
  rawQuery: string,
  haystack: string = searchHaystack(item),
): boolean {
  const query = normalizeSearchText(rawQuery);
  if (query === "") return true;
  return matchesNormalizedQuery(query, haystack);
}

/** The matcher behind matchesCatalogQuery, for a query and haystack that are
 *  already normalized (src/lib/siteSearch.ts reuses it). */
export function matchesNormalizedQuery(query: string, haystack: string): boolean {
  const squeezedHaystack = squeeze(haystack);
  // Whole-phrase hit first (covers "rnb" vs "R&B" and "hiphop" vs "Hip-Hop").
  if (squeezedHaystack.includes(squeeze(query))) return true;

  return query
    .split(" ")
    .every(
      (word) =>
        squeezedHaystack.includes(squeeze(word)) || wordMatches(word, haystack),
    );
}
