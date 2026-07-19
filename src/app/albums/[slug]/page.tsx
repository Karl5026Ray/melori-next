import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BuyButton from "@/components/BuyButton";
import CoverImage from "@/components/CoverImage";
import PlayReleaseButton from "@/components/PlayReleaseButton";
import TrackList from "@/components/TrackList";
import { getReleaseBySlug } from "@/lib/data";
import { formatPrice } from "@/lib/format";

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
  const description =
    release.description ??
    `Listen to ${release.title}${byline} on MELORI Music.`;
  const images = release.cover_art_url
    ? [release.cover_art_url]
    : undefined;

  return {
    title: release.title,
    description,
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

  const { release, artist, tracks } = data;

  return (
    <article className="max-w-6xl mx-auto px-6 py-12">
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
            <span aria-hidden="true" className="text-text-secondary/40 select-none">·</span>
            <span className="font-semibold text-brand-primary">
              {formatPrice(release.price)}
            </span>
          </div>
          {/* Free streaming is the core promise — give it a prominent control
             right beside Buy, not just the small per-track play circles. */}
          <PlayReleaseButton
            tracks={tracks}
            artistName={artist?.name ?? null}
            coverUrl={release.cover_art_url}
          />
          {release.price != null && release.price > 0 && (
            <BuyButton releaseId={release.id} price={release.price} />
          )}
          {/* Reassure the buyer at the point of decision: their money goes to
             the artist, not the platform. This is Melori's key differentiator. */}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-text-secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0 text-brand-primary" aria-hidden>
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              100% goes to {artist?.name ?? "the artist"} — Melori takes no cut.
            </span>
          </p>
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
