import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import BuyButton from "@/components/BuyButton";
import { getStudioAlbumBySlug } from "@/lib/catalog";
import { formatPriceCents } from "@/lib/format";
import StudioAlbumTracks from "./StudioAlbumTracks";

export const dynamic = "force-dynamic";

// Public detail page for an artist-uploaded album (`studio_albums`).
//
// Three URL segments, so it cannot collide with /music/[id] (the studio
// single-track page) or /albums/[slug] (legacy releases). An unknown slug,
// or an album with nothing published behind it, 404s.

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const album = await getStudioAlbumBySlug(params.slug).catch(() => null);
  if (!album) return { title: "Album not found" };

  const description =
    album.description ?? `${album.title} by ${album.artistName} on MELORI Music.`;
  const images = album.coverUrl ? [album.coverUrl] : undefined;
  return {
    title: album.title,
    description,
    openGraph: { title: album.title, description, images },
    twitter: { title: album.title, description, images },
  };
}

export default async function StudioAlbumPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
  const album = await getStudioAlbumBySlug(params.slug).catch(() => null);
  if (!album) notFound();

  const isFree = album.priceCents === 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/music"
        className="text-sm text-text-secondary hover:text-brand-primary"
      >
        ← Back to Music
      </Link>

      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
        <CoverImage
          src={album.coverUrl}
          alt={`${album.title} cover art`}
          className="h-48 w-48 shrink-0"
          rounded="rounded-2xl"
        />

        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-text-secondary">
            Album
          </p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">{album.title}</h1>

          {album.artist ? (
            <Link
              href={`/artists/${album.artist.slug}`}
              className="mt-2 inline-block text-lg text-text-secondary transition-colors hover:text-brand-primary hover:underline"
            >
              {album.artistName}
            </Link>
          ) : (
            <p className="mt-2 text-lg text-text-secondary">{album.artistName}</p>
          )}

          {album.description && (
            <p className="mt-3 max-w-2xl text-sm text-text-secondary">
              {album.description}
            </p>
          )}

          <p className="mt-3 text-sm text-text-secondary">
            {album.tracks.length} track{album.tracks.length === 1 ? "" : "s"} ·{" "}
            <span data-native-hide className="font-medium text-brand-primary">
              {formatPriceCents(album.priceCents)}
            </span>
          </p>

          {isFree ? (
            <p className="mt-4 text-sm text-text-secondary">
              This album is free — press play on any track below.
            </p>
          ) : (
            <BuyButton
              title={album.title}
              priceCents={album.priceCents}
              studioAlbumId={album.id}
            />
          )}
        </div>
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold">Tracks</h2>
        <StudioAlbumTracks
          tracks={album.tracks}
          artistName={album.artistName}
        />
      </section>
    </div>
  );
}
