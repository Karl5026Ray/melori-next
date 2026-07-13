"use client";

import { useState } from "react";
import MusicCatalog from "@/components/MusicCatalog";
import StudioTrackGrid from "@/components/StudioTrackGrid";
import type { ReleaseListItem, StudioTrackListItem } from "@/lib/data";

// Owns a single search query that drives BOTH the "Latest from Artists"
// (studio uploads) list and the release catalog below it. Previously each of
// those components rendered its own search box, so /music showed two search
// bars — confusing. Now there is one search at the top of the page.
export default function MusicPageClient({
  releases,
  studioTracks,
}: {
  releases: ReleaseListItem[];
  studioTracks: StudioTrackListItem[];
}) {
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

      <StudioTrackGrid tracks={studioTracks} externalQuery={query} />

      <div className="mt-16">
        <MusicCatalog releases={releases} externalQuery={query} />
      </div>
    </div>
  );
}
