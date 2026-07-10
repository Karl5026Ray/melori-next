import { Suspense } from "react";
import Link from "next/link";
import ReleaseCard from "@/components/ReleaseCard";
import SuccessBanner from "@/components/SuccessBanner";
import type { Metadata } from "next";
import { getReleases } from "@/lib/data";
import type { ReleaseListItem } from "@/lib/data";

export const dynamic = "force-dynamic";

const description =
"Stream freely, support directly, create endlessly. Discover independent music and artists on MELORI Music.";

export const metadata: Metadata = {
title: { absolute: "MELORI MUSIC — Independent Music Platform" },
description,
openGraph: {
title: "MELORI MUSIC — Independent Music Platform",
description,
images: ["/images/og-image.png"],
},
twitter: {
card: "summary_large_image",
title: "MELORI MUSIC — Independent Music Platform",
description,
images: ["/images/og-image.png"],
},
};

function ReleaseSection({
title,
releases,
viewAllHref,
}: {
title: string;
releases: ReleaseListItem[];
viewAllHref: string;
}) {
if (releases.length === 0) return null;
return (
<section className="max-w-6xl mx-auto px-6 pt-4 pb-12">
<div className="mb-6 flex items-end justify-between">
<h2 className="text-2xl font-bold">{title}</h2>
<Link
href={viewAllHref}
className="text-sm text-text-secondary hover:text-brand-primary transition-colors"
>
View all
</Link>
</div>
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
{releases.map((release) => (
<ReleaseCard key={release.id} release={release} />
))}
</div>
</section>
);
}

export default async function HomePage() {
const releases = await getReleases().catch(() => []);

const meloriFavorites = releases.slice(0, 12);

const albums = releases
.filter((r) => r.release_type === "album")
.slice(0, 12);

const singles = releases
.filter((r) => r.release_type === "single")
.slice(0, 12);

const sortedByDate = [...releases].sort((a, b) => {
const da = a.release_date ? new Date(a.release_date).getTime() : 0;
const db = b.release_date ? new Date(b.release_date).getTime() : 0;
return db - da;
});
const seenArtists = new Set<string>();
const newArtists: ReleaseListItem[] = [];
for (const release of sortedByDate) {
const key = release.artist?.slug;
if (!key || seenArtists.has(key)) continue;
seenArtists.add(key);
newArtists.push(release);
if (newArtists.length >= 12) break;
}

return (
<div>
<Suspense fallback={null}>
<SuccessBanner />
</Suspense>
{/* Hero */}
<section className="relative overflow-hidden">
<div className="hero-glow absolute inset-0 -z-10" aria-hidden />
<div className="max-w-5xl mx-auto px-6 pt-10 pb-10 flex flex-col items-center text-center">
<h1 className="text-5xl md:text-6xl font-bold tracking-tight">
MELORI MUSIC
</h1>
<p className="mt-4 text-lg md:text-xl text-text-secondary">
Stream freely. Support directly. <span className="whitespace-nowrap">Create endlessly.</span>
</p>
</div>
</section>
{/* Curated home sections */}
<ReleaseSection title="Melori Favorites" releases={meloriFavorites} viewAllHref="/music" />
<ReleaseSection title="Albums" releases={albums} viewAllHref="/music?type=album" />
<ReleaseSection title="Singles" releases={singles} viewAllHref="/music?type=single" />
<ReleaseSection title="New Artists" releases={newArtists} viewAllHref="/artists" />
</div>
);
}
