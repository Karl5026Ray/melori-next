// One search across Melori: artists, music (albums, singles and the songs
// inside them), radio shows and books.
//
// Karl, 2026-11-27: "find ways to make our search easier and better." Before
// this, the only search box on the site was the one on /music, and it only
// filtered music releases. Artists, books and shows could not be searched at
// all, and a typo found nothing.
//
// Pure functions only, so the ranking runs in the client component and is
// pinned by scripts/site-search.test.ts. The index itself is built on the
// server (src/app/search/page.tsx) from data every visitor sees the same.

import { matchesNormalizedQuery, normalizeSearchText } from "@/lib/catalogSearch";

export type SearchKind = "artist" | "music" | "show" | "book";

export interface SearchEntry {
  key: string;
  kind: SearchKind;
  title: string;
  /** One line under the title: artist name, "Album", series name… */
  subtitle: string | null;
  href: string;
  /** External links (book stores) open in a new tab. */
  external?: boolean;
  image: string | null;
  /** Everything this entry can be found by, already normalized. */
  haystack: string;
  /** Normalized title, for ranking a title hit above a passing mention. */
  titleKey: string;
  /** Song titles inside an album, so a song hit can say "Song on <album>". */
  songs?: string[];
}

export interface SearchHit extends SearchEntry {
  score: number;
  /** Set when the match came from a song inside this item. */
  matchedSong?: string;
}

/** Build an entry, normalizing its search text once. */
export function makeEntry(
  e: Omit<SearchEntry, "haystack" | "titleKey"> & { extra?: (string | null | undefined)[] },
): SearchEntry {
  const { extra, ...rest } = e;
  return {
    ...rest,
    titleKey: normalizeSearchText(e.title),
    haystack: normalizeSearchText(
      [e.title, e.subtitle ?? "", ...(e.songs ?? []), ...(extra ?? []).map((x) => x ?? "")].join(
        " | ",
      ),
    ),
  };
}

// Artists first: a name search is the most common search on a music site.
const KIND_WEIGHT: Record<SearchKind, number> = { artist: 30, music: 20, book: 10, show: 5 };

function scoreEntry(entry: SearchEntry, query: string): number {
  const t = entry.titleKey;
  let score = KIND_WEIGHT[entry.kind];
  if (t === query) score += 100;
  else if (t.startsWith(query)) score += 70;
  else if (t.includes(query)) score += 50;
  else if (t.split(" ").some((w) => w.startsWith(query.split(" ")[0]))) score += 25;
  return score;
}

/**
 * Every entry the query matches, best first. Typo tolerant (see
 * matchesNormalizedQuery). An empty query returns nothing: the page shows
 * suggestions instead of a wall of everything.
 */
export function searchSite(entries: SearchEntry[], rawQuery: string): SearchHit[] {
  const query = normalizeSearchText(rawQuery);
  if (query === "") return [];
  const hits: SearchHit[] = [];
  for (const entry of entries) {
    if (!matchesNormalizedQuery(query, entry.haystack)) continue;
    let matchedSong: string | undefined;
    if (entry.songs && !matchesNormalizedQuery(query, entry.titleKey)) {
      matchedSong = entry.songs.find((s) => matchesNormalizedQuery(query, normalizeSearchText(s)));
    }
    hits.push({ ...entry, score: scoreEntry(entry, query) + (matchedSong ? 15 : 0), matchedSong });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/** Hits grouped for display, in a fixed section order, empty sections dropped. */
export function groupHits(hits: SearchHit[]): { kind: SearchKind; label: string; hits: SearchHit[] }[] {
  const order: [SearchKind, string][] = [
    ["artist", "Artists"],
    ["music", "Music"],
    ["book", "Books"],
    ["show", "Radio shows"],
  ];
  return order
    .map(([kind, label]) => ({ kind, label, hits: hits.filter((h) => h.kind === kind) }))
    .filter((g) => g.hits.length > 0);
}
