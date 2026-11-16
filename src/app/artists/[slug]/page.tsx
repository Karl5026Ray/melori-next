import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import ShareButton from "@/components/ShareButton";
import ArtistDiscography from "@/components/ArtistDiscography";
import ProfileGallery from "@/components/ProfileGallery";
import { MemberActions } from "@/components/social/MemberActions";
import { SocialAuthProvider } from "@/components/social/providers/AuthProvider";
import JsonLd from "@/components/JsonLd";
import { getArtistBySlug } from "@/lib/data";
import { SITE_URL } from "@/lib/site";
import {
  getStudioCatalogForProfile,
  type CatalogItem,
} from "@/lib/catalog";
import CatalogCard from "@/components/CatalogCard";
import { ARTIST_FRONT_DOORS, activePins } from "@/lib/artistFrontDoor";

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
  // The search-result sentence (migration 098) first; the bio is still what
  // the page shows.
  const description =
    artist.seo_description ??
    artist.bio ??
    `Discover music by ${artist.name} on MELORI Music.`;
  const cover =
    artist.cover_image_url ??
    artist.avatar_url ??
    releases.find((r) => r.cover_art_url)?.cover_art_url ??
    null;
  const images = cover ? [cover] : undefined;

  return {
    title: artist.name,
    description,
    alternates: { canonical: `/artists/${artist.slug}` },
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

  // The artist's whole body of work in one grid: curated releases plus
  // everything they uploaded through the Artist Studio. Before this, a
  // self-uploading artist's profile showed "No releases yet" no matter how
  // much music they had published.
  const studioItems = artist.profile_id
    ? await getStudioCatalogForProfile(artist.profile_id).catch(() => [])
    : [];

  const catalogItems: CatalogItem[] = [
    ...releases.map((r) => ({
      key: `release:${r.id}`,
      kind: "release" as const,
      id: String(r.id),
      title: r.title,
      href: `/albums/${r.slug}`,
      release_type: r.release_type,
      cover_art_url: r.cover_art_url,
      release_date: r.release_date,
      artist: { name: artist.name, slug: artist.slug },
      genre: null,
    })),
    ...studioItems,
  ];

  // Start here + links out + support (src/lib/artistFrontDoor.ts). Only
  // artists with an entry get these; everyone else renders as before.
  const frontDoor = ARTIST_FRONT_DOORS[artist.slug] ?? null;
  const byKey = new Map(catalogItems.map((i) => [i.key, i]));
  const startHere = frontDoor
    ? activePins(frontDoor)
        .map((pin) => ({ pin, item: byKey.get(pin.key) }))
        .filter((x): x is { pin: typeof x.pin; item: CatalogItem } => Boolean(x.item))
    : [];

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "MusicGroup",
          name: artist.name,
          url: `${SITE_URL}/artists/${artist.slug}`,
          ...(artist.avatar_url || artist.cover_image_url
            ? { image: artist.avatar_url ?? artist.cover_image_url }
            : {}),
          ...(artist.bio ? { description: artist.bio } : {}),
          album: releases.map((r) => ({
            "@type": "MusicAlbum",
            name: r.title,
            url: `${SITE_URL}/albums/${r.slug}`,
          })),
        }}
      />
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

        {/* Photos sit above the message actions — only renders when this
           artist's profile has gallery photos. */}
        {artist.profile_id && (
          <ProfileGallery profileId={artist.profile_id} className="mt-8" />
        )}

        {/* Message / block / report. Renders nothing when signed out, when this
           artist has no member profile, or when you're viewing your own page.
           MemberActions reads the signed-in member from SocialAuthProvider,
           which only wraps /social/* — so it is provided here for this subtree. */}
        {artist.profile_id && (
          <SocialAuthProvider>
            <div className="mt-5 flex justify-center sm:justify-start">
              <MemberActions
                memberId={artist.profile_id}
                memberName={artist.name}
              />
            </div>
          </SocialAuthProvider>
        )}

        {/* Bio */}
        {artist.bio && (
          <p className="mt-6 max-w-3xl text-text-secondary">{artist.bio}</p>
        )}

        {/* Ways out of the page (review, 16 Nov 2026: "Anyone who falls for
            the music has nowhere to go"). */}
        {frontDoor && frontDoor.links.length > 0 && (
          <nav aria-label={`More from ${artist.name}`} className="mt-4 flex flex-wrap gap-2" data-testid="artist-links">
            {frontDoor.links.map((l) => {
              const external = /^https?:\/\//.test(l.href);
              return (
                <a
                  key={l.href}
                  href={l.href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="rounded-full border border-brand-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand-primary hover:text-brand-primary"
                >
                  {l.label}
                </a>
              );
            })}
          </nav>
        )}

        {frontDoor?.support && (
          <a
            href={frontDoor.support.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="artist-support"
            className="mt-4 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-brand-primary/40 bg-brand-primary/10 px-4 py-3 transition-colors hover:bg-brand-primary/20"
          >
            <span>
              <span className="block text-sm font-semibold text-brand-primary">{frontDoor.support.label}</span>
              <span className="block text-sm text-text-secondary">{frontDoor.support.line}</span>
            </span>
            <span aria-hidden className="text-brand-primary">&rarr;</span>
          </a>
        )}

        {/* Start here — a path through a big catalog. */}
        {startHere.length > 0 && (
          <section className="pt-10" data-testid="artist-start-here">
            <h2 className="mb-1 text-2xl font-bold">Start here</h2>
            <p className="mb-5 text-sm text-text-secondary">New to {artist.name}? Begin with one of these.</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {startHere.map(({ pin, item }) => (
                <div key={pin.key}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-primary">{pin.label}</p>
                  <CatalogCard item={item} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Discography */}
        <section className="py-12">
          <h2 className="mb-6 text-2xl font-bold">{startHere.length > 0 ? "Everything" : "Discography"}</h2>
          <ArtistDiscography items={catalogItems} />
        </section>
      </div>
    </article>
  );
}
