"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ReleaseCard from "@/components/ReleaseCard";
import type { ReleaseListItem } from "@/lib/data";
import {
DEFAULT_RELEASE_SORT,
RELEASE_SORT_OPTIONS,
sortReleases,
type ReleaseSort,
} from "@/lib/releaseSort";

type TypeFilter = "all" | "album" | "single";

// The nav's Albums/Singles tabs link to /music?type=album|single. Normalize the
// raw query value to a valid TypeFilter so an unexpected/absent param falls back
// to "all".
function normalizeType(raw: string | null | undefined): TypeFilter {
  return raw === "album" || raw === "single" ? raw : "all";
}

// Common music genres always offered in the filter, even when no published
// release currently uses them. Casing matches the values stored on releases
// so the `r.genre === genre` filter keeps working. A canonical genre with no
// releases simply yields the existing empty-state message.
const CANONICAL_GENRES = [
"Hip Hop",
"R&B",
"Pop",
"Rock",
"Electronic",
"Jazz",
"Country",
"Gospel",
"Reggae",
"Latin",
"Classical",
"Soul",
];

export default function MusicCatalog({
releases,
externalQuery,
}: {
releases: ReleaseListItem[];
// When provided, the search box is hidden and this value drives filtering
// instead — used by the /music page to share one search input across the
// studio-uploads list and this catalog (avoids two search bars on one page).
externalQuery?: string;
}) {
const [localQuery, setLocalQuery] = useState("");
const query = externalQuery ?? localQuery;
const [genre, setGenre] = useState("all");
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
// The release-type filter is driven by the URL so the nav's Albums/Singles
// tabs (which are just /music?type=album|single links) actually take effect —
// and so clicking one clears the other instead of feeling "stuck together".
const urlType = normalizeType(searchParams.get("type"));
const [typeFilter, setTypeFilter] = useState<TypeFilter>(urlType);
// Client-side nav between ?type=album and ?type=single doesn't remount this
// component, so keep local state in sync when the param changes.
useEffect(() => {
  setTypeFilter(urlType);
}, [urlType]);
// Clicking an in-page pill updates the URL (single source of truth); the
// effect above then syncs typeFilter. Keeps pills and nav tabs consistent.
const selectType = (t: TypeFilter) => {
  setTypeFilter(t);
  const params = new URLSearchParams(Array.from(searchParams.entries()));
  if (t === "all") params.delete("type");
  else params.set("type", t);
  const qs = params.toString();
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
};
const [sort, setSort] = useState<ReleaseSort>(DEFAULT_RELEASE_SORT);

const genres = useMemo(() => {
// Merge the canonical list with genres actually present on releases,
// deduped case-insensitively (first spelling wins), then sorted.
const byKey = new Map<string, string>();
for (const g of [...CANONICAL_GENRES, ...releases.map((r) => r.genre)]) {
if (!g) continue;
const key = g.toLowerCase();
if (!byKey.has(key)) byKey.set(key, g);
}
return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
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
onClick={() => selectType(t.key)}
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
{externalQuery === undefined && (
<input
type="search"
value={localQuery}
onChange={(e) => setLocalQuery(e.target.value)}
placeholder="Search by title or artist…"
className="w-full rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none sm:max-w-sm"
/>
)}
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
