import Image from "next/image";
import Link from "next/link";
import ReleaseCard from "@/components/ReleaseCard";
import ArtistCard from "@/components/ArtistCard";
import type { Metadata } from "next";
import { getReleases, getArtists } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

interface FeaturedVideo {
  youtube_id: string;
  title: string;
}

async function getFeaturedVideo(): Promise<FeaturedVideo | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("videos")
      .select("youtube_id, title")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as FeaturedVideo) ?? null;
  } catch {
    return null;
  }
}

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
  const [releases, artists, featuredVideo] = await Promise.all([
    getReleases().catch(() => []),
    getArtists().catch(() => []),
    getFeaturedVideo(),
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

      {/* Featured video */}
      {featuredVideo && (
        <section className="max-w-5xl mx-auto px-6 py-12">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-2xl font-bold">Featured Video</h2>
            <Link
              href="/video"
              className="text-sm text-text-secondary hover:text-brand-primary transition-colors"
            >
              View all
            </Link>
          </div>
          <div
            className="relative w-full overflow-hidden rounded-lg bg-black"
            style={{ paddingTop: "56.25%" }}
          >
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube.com/embed/${featuredVideo.youtube_id}`}
              title={featuredVideo.title}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <p className="mt-3 text-sm text-text-secondary">{featuredVideo.title}</p>
        </section>
      )}
    </div>
  );
}
