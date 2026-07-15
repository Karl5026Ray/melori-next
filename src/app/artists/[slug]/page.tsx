import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import ShareButton from "@/components/ShareButton";
import ArtistDiscography from "@/components/ArtistDiscography";
import SuperfanButton from "@/components/SuperfanButton";
import ProfileGallery from "@/components/ProfileGallery";
import { getArtistBySlug } from "@/lib/data";
import type { ReleaseListItem } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const data = await getArtistBySlug(params.slug).catch(() => null);
  if (!data) return { title: "Artist not found" };

  const { artist, releases } = data;
  const description =
    artist.bio ?? `Discover music by ${artist.name} on MELORI Music.`;
  const cover =
    artist.cover_image_url ??
    artist.avatar_url ??
    releases.find((r) => r.cover_art_url)?.cover_art_url ??
    null;
  const images = cover ? [cover] : undefined;

  return {
    title: artist.name,
    description,
    openGraph: { title: artist.name, description, type: "profile", images },
    twitter: { title: artist.name, description, images },
  };
}

export default async function ArtistDetailPage(
  props: {
    params: Promise<{ slug: string }>;
  }
) {
  const params = await props.params;
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
    <article>
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
        {/* Horizontal header: photo next to name across the top.
            Stacks vertically on mobile, side-by-side from sm up. */}
        <div className="relative z-10 -mt-20 flex flex-col items-center gap-4 text-center sm:-mt-24 sm:flex-row sm:items-end sm:gap-6 sm:text-left">
          <CoverImage
            src={artist.avatar_url}
            alt={artist.name}
            name={artist.name}
            className="h-32 w-32 shrink-0 border-4 border-brand-background bg-brand-background shadow-xl sm:h-40 sm:w-40"
            rounded="rounded-full"
          />
          <div className="flex min-w-0 items-center gap-3 sm:pb-3">
            <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:justify-start sm:text-4xl lg:text-5xl">
              <span className="truncate">{artist.name}</span>
              {artist.is_verified && (
                <span className="text-brand-primary" title="Verified">
                  ✓
                </span>
              )}
            </h1>
            <ShareButton
              url={`https://melorimusic.org/artists/${artist.slug}`}
              title={`${artist.name} on MELORI MUSIC`}
              text={`Check out ${artist.name} on MELORI MUSIC — stream their music free and support them directly.`}
              label={`Share ${artist.name}`}
            />
          </div>
        </div>

        {/* Bio */}
        {artist.bio && (
          <p className="mt-6 max-w-3xl text-text-secondary">{artist.bio}</p>
        )}

        {/* Superfans dropdown */}
        <SuperfanButton slug={artist.slug} />

        {/* Discography */}
        <section className="py-12">
          <h2 className="mb-6 text-2xl font-bold">Discography</h2>
          <ArtistDiscography releases={releaseItems} />
        </section>

        {/* Photos — only renders when this artist's profile has gallery photos */}
        {artist.profile_id && (
          <ProfileGallery profileId={artist.profile_id} className="pb-12" />
        )}
      </div>
    </article>
  );
}
