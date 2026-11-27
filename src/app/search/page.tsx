import type { Metadata } from "next";
import { Suspense } from "react";
import { unstable_rethrow } from "next/navigation";
import SearchClient from "@/components/search/SearchClient";
import { getArtists, getReleases } from "@/lib/data";
import { getCatalogItems } from "@/lib/catalog";
import { BOOK_SERIES, bookUrlFor, coverUrlFor } from "@/lib/books";
import { makeEntry, type SearchEntry } from "@/lib/siteSearch";

// One search across Melori (Karl, 2026-11-27). The tab bar's Explore button
// (a magnifying glass) lands here.
//
// ISR, never force-dynamic: force-dynamic stamps `no-store`, which the iOS
// app's WKWebView treats as a failed load (issue #280, tasks/lessons.md). The
// index is identical for every visitor, so it is built here once a minute and
// the query is read on the client from ?q=.
//
// Members-only like /music (src/proxy.ts sends a signed-out visitor to
// /listen): the full catalog listing is a members' perk by Karl's choice.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Search",
  description: "Search artists, songs, albums, radio shows and books on MELORI Music.",
  robots: { index: false },
};

const RELEASE_LABEL = { album: "Album", ep: "EP", single: "Single" } as const;

async function buildIndex(): Promise<{ entries: SearchEntry[]; suggestions: SearchEntry[] }> {
  const [artists, releases] = await Promise.all([
    getArtists().catch((err) => {
      unstable_rethrow(err);
      console.error("search: artists failed", err);
      return [];
    }),
    getReleases().catch((err) => {
      unstable_rethrow(err);
      console.error("search: releases failed", err);
      return [];
    }),
  ]);
  const catalog = await getCatalogItems(releases);

  const artistEntries = artists.map((a) =>
    makeEntry({
      key: `artist:${a.id}`,
      kind: "artist",
      title: a.name,
      subtitle: "Artist",
      href: `/artists/${a.slug}`,
      image: a.avatar_url,
      extra: [a.seo_description],
    }),
  );

  const musicEntries = catalog.map((item) =>
    makeEntry({
      key: item.key,
      kind: item.isShow ? "show" : "music",
      title: item.title,
      subtitle: [item.artist?.name, item.isShow ? "Radio show" : RELEASE_LABEL[item.release_type]]
        .filter(Boolean)
        .join(" · "),
      href: item.href,
      image: item.cover_art_url,
      // A single's only "song" is itself; listing it adds nothing.
      songs: item.release_type === "single" ? undefined : item.trackTitles,
      extra: [item.genre],
    }),
  );

  const bookEntries: SearchEntry[] = [];
  for (const series of BOOK_SERIES) {
    for (const book of series.books) {
      // Same rule as the /books shelf: only books people can actually buy.
      const href = bookUrlFor(book);
      if (book.live === false || !href) continue;
      bookEntries.push(
        makeEntry({
          key: `book:${series.id}:${book.title}`,
          kind: "book",
          title: book.title,
          subtitle: `Book · ${series.name}`,
          href,
          external: true,
          image: coverUrlFor(book),
          extra: [series.name, series.audience, "book books"],
        }),
      );
    }
  }

  const entries = [...artistEntries, ...musicEntries, ...bookEntries];
  // Shown before anything is typed: the featured artists, else the first few.
  const featured = artists.filter((a) => a.is_featured);
  const pick = (featured.length ? featured : artists).slice(0, 8).map((a) => `artist:${a.id}`);
  const suggestions = artistEntries.filter((e) => pick.includes(e.key));
  return { entries, suggestions };
}

export default async function SearchPage() {
  const { entries, suggestions } = await buildIndex();
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold mb-4">Search</h1>
      {/* useSearchParams needs a Suspense boundary to keep this page static. */}
      <Suspense fallback={null}>
        <SearchClient entries={entries} suggestions={suggestions} />
      </Suspense>
    </div>
  );
}
