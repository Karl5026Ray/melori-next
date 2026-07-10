"use client";

import { useMemo, useState } from "react";
import ReleaseCard from "@/components/ReleaseCard";
import type { ReleaseListItem } from "@/lib/data";

type Category = "favorites" | "albums" | "singles" | "artists";

const CATEGORIES: { key: Category; label: string }[] = [
{ key: "favorites", label: "Melori Favorites" },
{ key: "albums", label: "Albums" },
{ key: "singles", label: "Singles" },
{ key: "artists", label: "New Artists" },
];

export default function HomeReleaseBrowser({
releases,
}: {
releases: ReleaseListItem[];
}) {
const [active, setActive] = useState<Category>("favorites");

const grouped = useMemo(() => {
const favorites = releases.slice(0, 12);
const albums = releases.filter((r) => r.release_type === "album").slice(0, 12);
const singles = releases.filter((r) => r.release_type === "single").slice(0, 12);
const sortedByDate = [...releases].sort((a, b) => {
const da = a.release_date ? new Date(a.release_date).getTime() : 0;
const db = b.release_date ? new Date(b.release_date).getTime() : 0;
return db - da;
});
const seen = new Set<string>();
const artists: ReleaseListItem[] = [];
for (const release of sortedByDate) {
const key = release.artist?.slug;
if (!key || seen.has(key)) continue;
seen.add(key);
artists.push(release);
if (artists.length >= 12) break;
}
return { favorites, albums, singles, artists };
}, [releases]);

const shown = grouped[active];

return (
<section className="max-w-6xl mx-auto px-6 pt-4 pb-12">
<div className="mb-6 flex flex-wrap gap-2">
{CATEGORIES.map((cat) => {
const isActive = cat.key === active;
return (
<button
key={cat.key}
type="button"
onClick={() => setActive(cat.key)}
aria-pressed={isActive}
className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
isActive
? "bg-brand-primary text-black"
: "border border-brand-border text-text-secondary hover:text-brand-primary"
}`}
>
{cat.label}
</button>
);
})}
</div>
{shown.length > 0 ? (
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
{shown.map((release) => (
<ReleaseCard key={release.id} release={release} />
))}
</div>
) : (
<p className="text-text-secondary">Nothing here yet.</p>
)}
</section>
);
}
