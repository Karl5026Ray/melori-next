// Catalog search matching for the /music page (and any other catalog grid).
//
// The old filter only looked at the release title and the artist name, as one
// exact lowercase substring. That missed the searches people actually type:
//   * a song title that lives inside an album ("Champion" on BINO)
//   * a genre ("gospel", "r&b")
//   * punctuation and accent differences ("dont" vs "Don't", "Beyonce" vs
//     "Beyoncé", "rnb" vs "R&B")
//   * words out of order or spread across fields ("karl woe")
//   * typos and near-misses ("champian", "glria", "relanch")
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

/** How many typos a word of this length may carry and still count. Short
 *  words must be exact or a prefix, or "go" would match half the catalog. */
export function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** Edit distance with a cutoff: returns max+1 as soon as the distance is
 *  known to exceed max, so long titles stay cheap. Swapped neighbours ("teh"
 *  for "the") count as one edit. */
export function editDistance(a: string, b: string, max: number): number {
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

/** Score one query word against the item: 3 exact word, 2 inside a word
 *  (prefix or substring), 1 near-miss within the typo budget, 0 no match. */
function scoreWord(word: string, haystack: string, words: string[]): number {
  if (words.includes(word)) return 3;
  if (haystack.includes(word) || squeeze(haystack).includes(squeeze(word))) return 2;
  const budget = allowedTypos(word.length);
  if (budget === 0) return 0;
  for (const w of words) {
    // Compare against the whole word, and against its start so a typo in a
    // half-typed word ("chamq") still finds "champion".
    if (editDistance(word, w, budget) <= budget) return 1;
    if (
      w.length > word.length &&
      editDistance(word, w.slice(0, word.length), budget) <= budget
    ) {
      return 1;
    }
  }
  return 0;
}

/**
 * 0 when the item doesn't match. Otherwise a relevance score: higher means a
 * closer match, so exact hits can be listed ahead of typo matches. Every word
 * of the query has to land somewhere in the title, artist, genre or tracks.
 */
export function scoreCatalogQuery(
  item: SearchableCatalogItem,
  rawQuery: string,
  haystack: string = searchHaystack(item),
): number {
  const query = normalizeSearchText(rawQuery);
  if (query === "") return 1;

  const words = haystack.split(" ").filter(Boolean);
  let total = 0;
  for (const word of query.split(" ")) {
    const s = scoreWord(word, haystack, words);
    if (s === 0) {
      // Last chance for the whole phrase squeezed ("rnb" vs "R&B").
      return squeeze(haystack).includes(squeeze(query)) ? 2 : 0;
    }
    total += s;
  }
  // A title hit outranks the same words found only in a track or genre.
  if (normalizeSearchText(item.title).includes(query)) total += 2;
  return total;
}

/** True when every word of the query matches, exactly or within a typo or two. */
export function matchesCatalogQuery(
  item: SearchableCatalogItem,
  rawQuery: string,
  haystack?: string,
): boolean {
  return scoreCatalogQuery(item, rawQuery, haystack) > 0;
}
