"use client";

import { useState } from "react";
import MusicCatalog from "@/components/MusicCatalog";
import type { CatalogItem } from "@/lib/catalog";

// Owns the page's single search box and hands the query down to the one
// catalog grid.
//
// This page used to render two lists: a "Latest from Artists" strip of studio
// uploads above the release catalog. That split is gone — artist uploads are
// ordinary catalog items now, so there is one list, one search, one sort.
//
// Shows (Karl, 26 Nov 2026): recorded Melori Radio shows have their own tab so
// an hour-long show never sits in the grid as if it were a song. The tab only
// appears once at least one show is published.
export default function MusicPageClient({ items }: { items: CatalogItem[] }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"music" | "shows">("music");
  const shows = items.filter((i) => i.isShow);
  const music = items.filter((i) => !i.isShow);
  const showing = tab === "shows" && shows.length ? shows : music;

  return (
    <div>
      {shows.length > 0 && (
        <div className="mb-4 inline-flex rounded-full border border-brand-border bg-brand-surface p-1">
          {(
            [
              { t: "music", label: "Music" },
              { t: "shows", label: `Shows (${shows.length})` },
            ] as const
          ).map(({ t, label }) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === t
                  ? "bg-brand-primary text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-8">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, artist, song or genre…"
          aria-label="Search all music"
          className="w-full rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none sm:max-w-md"
        />
      </div>

      <MusicCatalog items={showing} externalQuery={query} />
    </div>
  );
}
