"use client";

import { useMemo, useState } from "react";
import ReleaseCard from "@/components/ReleaseCard";
import type { ReleaseListItem } from "@/lib/data";
import {
  RELEASE_SORT_OPTIONS,
  sortReleases,
  type ReleaseSort,
} from "@/lib/releaseSort";

// Client-side discography grid with a sort control, matching the /music
// catalog. Default sort is Alphabetical by title.
export default function ArtistDiscography({
  releases,
}: {
  releases: ReleaseListItem[];
}) {
  const [sort, setSort] = useState<ReleaseSort>("alpha");

  const sorted = useMemo(() => sortReleases(releases, sort), [releases, sort]);

  if (releases.length === 0) {
    return <p className="text-text-secondary">No releases yet.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ReleaseSort)}
            className="rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary focus:border-brand-primary focus:outline-none"
          >
            {RELEASE_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((release) => (
          <ReleaseCard key={release.id} release={release} />
        ))}
      </div>
    </div>
  );
}
