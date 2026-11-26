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
export default function MusicPageClient({ items }: { items: CatalogItem[] }) {
  const [query, setQuery] = useState("");

  return (
    <div>
      <div className="mb-8">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all music by title or artist…"
          aria-label="Search all music"
          className="w-full rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none sm:max-w-md"
        />
      </div>

      <MusicCatalog items={items} externalQuery={query} />
    </div>
  );
}
