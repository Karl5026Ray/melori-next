import Image from "next/image";
import Link from "next/link";
import ReleaseCard from "@/components/ReleaseCard";
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
  const featuredReleases = releases.slice(0, 12);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-5xl mx-auto px-6 pt-24 pb-10 flex flex-col items-center text-center">
          <Image
            src="/logo/logo.png"
            alt="MELORI Music logo"
            width={120}
            height={120}
            priority
            className="mb-8"
          />
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            MELORI MUSIC
          </h1>
          <p className="mt-4 text-lg md:text-xl text-text-secondary">
            Stream freely. Support directly. Create endlessly.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/music"
              className="px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
            >
              Browse Music
            </Link>
            <Link
              href="/video"
              className="px-6 py-3 rounded-full font-semibold border border-brand-border hover:border-brand-primary transition-colors"
            >
              Watch Videos
            </Link>
            <Link
              href="/artists"
              className="px-6 py-3 rounded-full font-semibold border border-brand-border hover:border-brand-primary transition-colors"
            >
              Artists
            </Link>
          </div>
        </div>
      </section>

      {/* Featured releases — top 12 */}
      {featuredReleases.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 pt-4 pb-16">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-2xl font-bold">Featured Releases</h2>
            <Link
              href="/music"
              className="text-sm text-text-secondary hover:text-brand-primary transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {featuredReleases.map((release) => (
              <ReleaseCard key={release.id} release={release} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
