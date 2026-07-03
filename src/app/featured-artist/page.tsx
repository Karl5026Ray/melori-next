import type { Metadata } from "next";
import Link from "next/link";
import CoverImage from "@/components/CoverImage";
import ArtistCard from "@/components/ArtistCard";
import { getFeaturedArtists } from "@/lib/data";

export const dynamic = "force-dynamic";

const description =
  "Meet the featured artists on MELORI Music — spotlighted talent from our independent community.";

export const metadata: Metadata = {
  title: "Featured Artist",
  description,
  openGraph: {
    title: "Featured Artist",
    description,
    images: ["/images/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Featured Artist",
    description,
    images: ["/images/og-image.png"],
  },
};

export default async function FeaturedArtistPage() {
  const featured = await getFeaturedArtists().catch(() => []);
  const [spotlight, ...rest] = featured;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold">Featured Artist</h1>
      <p className="mt-2 mb-10 text-text-secondary">
        Spotlighting standout talent from the MELORI community.
      </p>

      {!spotlight ? (
        <p className="text-text-secondary">No featured artist selected yet.</p>
      ) : (
        <>
          {/* Spotlight hero */}
          <Link
            href={`/artists/${spotlight.slug}`}
            className="group block overflow-hidden rounded-2xl border border-brand-border bg-brand-surface transition-colors hover:border-brand-primary"
          >
            <div className="flex flex-col items-center gap-6 p-8 text-center sm:flex-row sm:text-left">
              <CoverImage
                src={spotlight.avatar_url}
                alt={spotlight.name}
                className="h-40 w-40 shrink-0"
                rounded="rounded-full"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary">
                  Spotlight
                </p>
                <h2 className="mt-1 flex items-center justify-center gap-2 text-2xl font-bold text-text-primary group-hover:text-brand-primary sm:justify-start">
                  <span className="truncate">{spotlight.name}</span>
                  {spotlight.is_verified && (
                    <span
                      className="text-brand-primary"
                      aria-label="Verified"
                      title="Verified"
                    >
                      ✓
                    </span>
                  )}
                </h2>
                {spotlight.bio && (
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-secondary">
                    {spotlight.bio}
                  </p>
                )}
                <span className="mt-4 inline-block rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-brand-primary-dark">
                  View profile
                </span>
              </div>
            </div>
          </Link>

          {/* Additional featured artists */}
          {rest.length > 0 && (
            <div className="mt-12">
              <h3 className="mb-6 text-xl font-bold">More featured artists</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {rest.map((artist) => (
                  <ArtistCard key={artist.id} artist={artist} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-12">
            <Link
              href="/artists"
              className="text-sm text-text-secondary transition-colors hover:text-brand-primary"
            >
              Browse all artists →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
