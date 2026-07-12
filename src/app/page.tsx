import { Suspense } from "react";
import Link from "next/link";
import ReleaseCard from "@/components/ReleaseCard";
import SuccessBanner from "@/components/SuccessBanner";
import ShareButton from "@/components/ShareButton";
import type { Metadata } from "next";
import { getReleases } from "@/lib/data";

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

export default async function HomePage() {
  const releases = await getReleases().catch(() => []);
  const meloriFavorites = releases.slice(0, 12);

  return (
    <div>
      <Suspense fallback={null}>
        <SuccessBanner />
      </Suspense>

{/* Hero */}
<section className="relative overflow-hidden">
<div className="hero-glow absolute inset-0 -z-10" aria-hidden />
<div className="max-w-5xl mx-auto px-6 pt-14 pb-12 flex flex-col items-center text-center">
<h1 className="text-5xl md:text-6xl font-bold tracking-tight">MELORI MUSIC</h1>
<p className="mt-4 text-lg md:text-xl text-text-secondary">
Stream freely. Support directly.{" "}
<span className="whitespace-nowrap">Create endlessly.</span>
</p>
<p className="mt-4 max-w-2xl text-base text-text-secondary">
An independent music platform where fans stream the full catalog for free and support artists directly — and artists keep the majority of every sale.
</p>
<div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
<Link href="/music" className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90">Explore Music</Link>
<Link href="/membership" className="rounded-full border border-brand-border px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-white/5">Become an Artist</Link>
<Link href="/social/spaces" className="rounded-full border border-brand-border px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-white/5">Spaces</Link>
<ShareButton />
</div>
</div>
</section>

{/* Melori Favorites — top 12 only. */}
{meloriFavorites.length > 0 && (
<section className="max-w-6xl mx-auto px-6 pt-4 pb-12">
<div className="mb-6 flex items-end justify-between">
<h2 className="text-2xl font-bold">Melori Favorites</h2>
<Link href="/music" className="text-sm font-semibold text-brand-primary hover:underline">View all</Link>
</div>
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
{meloriFavorites.map((release) => (
<ReleaseCard key={release.id} release={release} />
))}
</div>
</section>
)}

{/* Why Melori — value props */}
<section className="max-w-6xl mx-auto px-6 pb-20">
<div className="grid gap-6 sm:grid-cols-3">
<div className="rounded-2xl border border-brand-border bg-white/5 p-6">
<h3 className="text-lg font-semibold text-text-primary">Stream freely</h3>
<p className="mt-2 text-sm text-text-secondary">Play the full catalog with no gatekeeping. Discover independent artists on your terms.</p>
</div>
<div className="rounded-2xl border border-brand-border bg-white/5 p-6">
<h3 className="text-lg font-semibold text-text-primary">Support directly</h3>
<p className="mt-2 text-sm text-text-secondary">Buy singles and albums or become a member. Your support goes straight to the artists you love.</p>
</div>
<div className="rounded-2xl border border-brand-border bg-white/5 p-6">
<h3 className="text-lg font-semibold text-text-primary">Create &amp; earn</h3>
<p className="mt-2 text-sm text-text-secondary">Upload your music, keep the majority of every sale, and build a fanbase that pays you fairly.</p>
</div>
</div>
</section>
</div>
);
}
