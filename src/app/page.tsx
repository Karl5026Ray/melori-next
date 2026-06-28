import Image from "next/image";
import Link from "next/link";
import ReleaseCard from "@/components/ReleaseCard";
import ArtistCard from "@/components/ArtistCard";
import { getReleases, getArtists } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [releases, artists] = await Promise.all([
    getReleases().catch(() => []),
    getArtists().catch(() => []),
  ]);

  const featuredReleases = releases.slice(0, 8);
  const featuredArtists = artists.slice(0, 8);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center">
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
              href="/artists"
              className="px-6 py-3 rounded-full font-semibold border border-brand-border hover:border-brand-primary transition-colors"
            >
              Artists
            </Link>
          </div>
        </div>
      </section>

      {/* Featured releases */}
      {featuredReleases.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12">
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

      {/* Featured artists */}
      {featuredArtists.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-2xl font-bold">Featured Artists</h2>
            <Link
              href="/artists"
              className="text-sm text-text-secondary hover:text-brand-primary transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {featuredArtists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
