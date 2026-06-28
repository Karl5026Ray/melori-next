"use client";

import { useMemo, useState } from "react";
import ReleaseCard from "@/components/ReleaseCard";
import type { ReleaseListItem } from "@/lib/data";

export default function MusicCatalog({
  releases,
}: {
  releases: ReleaseListItem[];
}) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("all");

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const r of releases) {
      if (r.genre) set.add(r.genre);
    }
    return Array.from(set).sort();
  }, [releases]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return releases.filter((r) => {
      const matchesGenre = genre === "all" || r.genre === genre;
      const matchesQuery =
        q === "" ||
        r.title.toLowerCase().includes(q) ||
        (r.artist?.name.toLowerCase().includes(q) ?? false);
      return matchesGenre && matchesQuery;
    });
  }, [releases, query, genre]);

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or artist…"
          className="w-full rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none sm:max-w-sm"
        />
        {genres.length > 0 && (
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary focus:border-brand-primary focus:outline-none"
          >
            <option value="all">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-text-secondary">No releases match your search.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((release) => (
            <ReleaseCard key={release.id} release={release} />
          ))}
        </div>
      )}
    </div>
  );
}
