import type { Metadata } from "next";
import Link from "next/link";
import ArtistCard from "@/components/ArtistCard";
import FeaturedSpotlight from "@/components/FeaturedSpotlight";
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
          {/* Spotlight hero — reflects the signed-in user's own profile when
             available, otherwise falls back to the admin-featured artist. */}
          <FeaturedSpotlight fallback={spotlight} />

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
