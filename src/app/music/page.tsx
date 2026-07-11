import type { Metadata } from "next";
import MusicCatalog from "@/components/MusicCatalog";
import StudioTrackGrid from "@/components/StudioTrackGrid";
import { getReleases, getPublishedStudioTracks } from "@/lib/data";

export const dynamic = "force-dynamic";

const description =
  "Browse every release on MELORI Music — singles, EPs, and albums from independent artists.";

export const metadata: Metadata = {
  title: "Music Catalog",
  description,
  openGraph: {
    title: "Music Catalog",
    description,
    images: ["/images/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Music Catalog",
    description,
    images: ["/images/og-image.png"],
  },
};

export default async function MusicPage() {
  // Load both sources in parallel — legacy releases and artist-studio uploads.
  // A failure in one list must not blank the other, so each has its own catch.
  const [releases, studioTracks] = await Promise.all([
    getReleases().catch(() => []),
    getPublishedStudioTracks(500).catch(() => []),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold">Music Catalog</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Browse every release on MELORI Music.
      </p>
      <MusicCatalog releases={releases} />
      <StudioTrackGrid tracks={studioTracks} />
    </div>
  );
}
