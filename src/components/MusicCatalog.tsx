"use client";

import { useMemo, useState } from "react";
import ReleaseCard from "@/components/ReleaseCard";
import type { ReleaseListItem } from "@/lib/data";
import {
RELEASE_SORT_OPTIONS,
sortReleases,
type ReleaseSort,
} from "@/lib/releaseSort";

type TypeFilter = "all" | "album" | "single";

export default function MusicCatalog({
releases,
}: {
releases: ReleaseListItem[];
}) {
const [query, setQuery] = useState("");
const [genre, setGenre] = useState("all");
const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
const [sort, setSort] = useState<ReleaseSort>("alpha");

const genres = useMemo(() => {
const set = new Set<string>();
for (const r of releases) {
if (r.genre) set.add(r.genre);
}
return Array.from(set).sort();
}, [releases]);

const albumCount = useMemo(
() => releases.filter((r) => r.release_type === "album").length,
[releases]
);
const singleCount = useMemo(
() => releases.filter((r) => r.release_type === "single").length,
[releases]
);

const filtered = useMemo(() => {
const q = query.trim().toLowerCase();
return releases.filter((r) => {
const matchesType = typeFilter === "all" || r.release_type === typeFilter;
const matchesGenre = genre === "all" || r.genre === genre;
const matchesQuery =
q === "" ||
r.title.toLowerCase().includes(q) ||
(r.artist?.name.toLowerCase().includes(q) ?? false);
return matchesType && matchesGenre && matchesQuery;
});
}, [releases, query, genre, typeFilter]);

const sorted = useMemo(
() => sortReleases(filtered, sort),
[filtered, sort]
);

const tabs: { key: TypeFilter; label: string; count: number }[] = [
{ key: "all", label: "All Releases", count: releases.length },
{ key: "album", label: "Albums", count: albumCount },
{ key: "single", label: "Singles", count: singleCount },
];

return (
<div>
<div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter releases">
{tabs.map((t) => (
<button
key={t.key}
type="button"
role="tab"
aria-selected={typeFilter === t.key}
onClick={() => setTypeFilter(t.key)}
className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
typeFilter === t.key
? "bg-brand-primary text-white"
: "border border-brand-border text-text-secondary hover:text-text-primary"
}`}
>
{t.label} ({t.count})
</button>
))}
</div>
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
{sorted.length === 0 ? (
<p className="text-text-secondary">No releases match your search.</p>
) : (
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
{sorted.map((release) => (
<ReleaseCard key={release.id} release={release} />
))}
</div>
)}
</div>
);
}
