import { notFound } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import ReleaseCard from "@/components/ReleaseCard";
import { getArtistBySlug } from "@/lib/data";
import type { ReleaseListItem } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ArtistDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await getArtistBySlug(params.slug).catch(() => null);
  if (!data) notFound();

  const { artist, releases } = data;

  // Adapt full Release rows to the card's list-item shape.
  const releaseItems: ReleaseListItem[] = releases.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    release_type: r.release_type,
    cover_art_url: r.cover_art_url,
    price: r.price,
    release_date: r.release_date,
    artist: { name: artist.name, slug: artist.slug },
    genre: null,
  }));

  return (
    <div>
      {/* Cover banner */}
      <div className="relative h-48 w-full overflow-hidden bg-brand-surface sm:h-64">
        <CoverImage
          src={artist.cover_image_url}
          alt={`${artist.name} cover`}
          className="h-full w-full"
          rounded="rounded-none"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-background to-transparent" />
      </div>

      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="-mt-16 flex flex-col items-center gap-4 sm:flex-row sm:items-end">
          <CoverImage
            src={artist.avatar_url}
            alt={artist.name}
            className="h-32 w-32 border-4 border-brand-background"
            rounded="rounded-full"
          />
          <div className="text-center sm:pb-2 sm:text-left">
            <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:justify-start">
              {artist.name}
              {artist.is_verified && (
                <span className="text-brand-primary" title="Verified">
                  ✓
                </span>
              )}
            </h1>
          </div>
        </div>

        {/* Bio */}
        {artist.bio && (
          <p className="mt-6 max-w-3xl text-text-secondary">{artist.bio}</p>
        )}

        {/* Discography */}
        <section className="py-12">
          <h2 className="mb-6 text-2xl font-bold">Discography</h2>
          {releaseItems.length === 0 ? (
            <p className="text-text-secondary">No releases yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {releaseItems.map((release) => (
                <ReleaseCard key={release.id} release={release} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
