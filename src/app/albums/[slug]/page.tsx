import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import PlayReleaseButton from "@/components/PlayReleaseButton";
import TrackList from "@/components/TrackList";
import JsonLd from "@/components/JsonLd";
import { getReleaseBySlug } from "@/lib/data";
import { redactMediaPaths } from "@/lib/publicTrack";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const data = await getReleaseBySlug(params.slug).catch(() => null);
  if (!data) return { title: "Release not found" };

  const { release, artist } = data;
  const byline = artist ? ` by ${artist.name}` : "";
  // The search-result sentence (migration 098) first; the release's own
  // description is still what the page shows.
  const description =
    release.seo_description ??
    release.description ??
    `Listen to ${release.title}${byline} on MELORI Music.`;
  const images = release.cover_art_url
    ? [release.cover_art_url]
    : undefined;

  return {
    title: release.title,
    description,
    alternates: { canonical: `/albums/${release.slug}` },
    openGraph: { title: release.title, description, type: "music.album", images },
    twitter: { title: release.title, description, images },
  };
}

export default async function AlbumDetailPage(
  props: {
    params: Promise<{ slug: string }>;
  }
) {
  const params = await props.params;
  const data = await getReleaseBySlug(params.slug).catch(() => null);
  if (!data) notFound();

  // This page is public (2026-10-15); the storage paths are not. See
  // src/lib/publicTrack.ts — playback streams by id through a signed-in route.
  const { release, artist } = data;
  const tracks = redactMediaPaths(data.tracks);

  return (
    <article className="max-w-6xl mx-auto px-6 py-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "MusicAlbum",
          name: release.title,
          url: `${SITE_URL}/albums/${release.slug}`,
          ...(release.cover_art_url ? { image: release.cover_art_url } : {}),
          ...(release.release_date ? { datePublished: release.release_date } : {}),
          ...(artist
            ? { byArtist: { "@type": "MusicGroup", name: artist.name, url: `${SITE_URL}/artists/${artist.slug}` } }
            : {}),
          numTracks: tracks.length,
          track: tracks.map((t, i) => ({
            "@type": "MusicRecording",
            name: t.title,
            position: t.track_number ?? i + 1,
          })),
        }}
      />
      <div className="flex flex-col gap-8 md:flex-row">
        {/* Cover + meta */}
        <div className="w-full max-w-xs shrink-0">
          <CoverImage
            src={release.cover_art_url}
            alt={release.title}
            className="aspect-square w-full"
          />
          <h1 className="mt-4 text-2xl font-bold">{release.title}</h1>
          {artist && (
            <Link
              href={`/artists/${artist.slug}`}
              className="mt-1 inline-block text-text-secondary transition-colors hover:text-brand-primary"
            >
              {artist.name}
            </Link>
          )}
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className="uppercase tracking-wide text-text-secondary">
              {release.release_type}
            </span>
          </div>
          <PlayReleaseButton
            tracks={tracks}
            artistName={artist?.name ?? null}
            coverUrl={release.cover_art_url}
          />
          {release.description && (
            <p className="mt-4 text-sm text-text-secondary">
              {release.description}
            </p>
          )}
        </div>

        {/* Tracklist */}
        <div className="min-w-0 flex-1">
          <h2 className="mb-4 text-xl font-bold">Tracks</h2>
          <TrackList
            tracks={tracks}
            artistName={artist?.name ?? null}
            coverUrl={release.cover_art_url}
          />
        </div>
      </div>
    </article>
  );
}
