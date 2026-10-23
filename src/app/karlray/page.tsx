import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Camera, Headphones, Heart, Tv } from "lucide-react";
import ChannelLinks from "@/components/ChannelLinks";
import CoverImage from "@/components/CoverImage";
import ShareButton from "@/components/ShareButton";
import MissionStatement from "@/components/MissionStatement";
import NameMeaning from "@/components/NameMeaning";
import HelpUsImprove from "@/components/HelpUsImprove";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { BOOK_SERIES, bookUrlFor, coverUrlFor } from "@/lib/books";
import {
  BOOKS_URL,
  KARL_ARTIST_PATH,
  KARL_PROFILE_ID,
  KARL_PROFILE_PATH,
  PORTFOLIO_GALLERY_SLUG,
  PORTFOLIO_URL,
  RELAUNCH_URL,
} from "@/lib/karlray";
import PortfolioGrid, { type PortfolioPhoto } from "./PortfolioGrid";
import OwnerUpload from "./OwnerUpload";

// Karl Ray's profile (2026-10-17): founder's page, link-in-bio for every
// social account, and the home of the Melori mission (moved from /mission).
//
// Public on purpose (PUBLIC_EXACT in src/proxy.ts): a bio link that lands on
// the signup door loses the visitor.
//
// ISR, not force-dynamic: dynamic pages get `no-store`, which iOS WKWebView
// wrappers (in-app browsers — exactly where bio links open) discard. See
// src/proxy.ts. New uploads appear within a minute.
export const revalidate = 60;

const PHOTO_LIMIT = 24;

const description =
  "Karl Ray: author, musician and photographer from Chicago, and the founder of Melori. Every book and every stream helps keep Melori free for artists.";

export const metadata: Metadata = {
  title: "Karl Ray",
  description,
  alternates: { canonical: `${SITE_URL}${KARL_PROFILE_PATH}` },
  openGraph: { title: "Karl Ray", description, images: ["/images/og-image.png"] },
};

interface ProfileData {
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  galleryId: string | null;
  photos: PortfolioPhoto[];
  photoCount: number;
}

async function getProfileData(): Promise<ProfileData> {
  const empty: ProfileData = {
    avatarUrl: null,
    bannerUrl: null,
    bio: null,
    galleryId: null,
    photos: [],
    photoCount: 0,
  };
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: profile }, { data: gallery }] = await Promise.all([
      supabase
        .from("profiles")
        .select("avatar_url, banner_url, bio")
        .eq("id", KARL_PROFILE_ID)
        .maybeSingle(),
      supabase
        .from("photo_galleries")
        .select("id")
        .eq("slug", PORTFOLIO_GALLERY_SLUG)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    let photos: PortfolioPhoto[] = [];
    let photoCount = 0;
    if (gallery?.id) {
      const [{ data: images }, { count }] = await Promise.all([
        supabase
          .from("photo_gallery_images")
          .select("id, thumbnail_key, preview_key, caption")
          .eq("gallery_id", gallery.id)
          .order("created_at", { ascending: false })
          .limit(PHOTO_LIMIT),
        supabase
          .from("photo_gallery_images")
          .select("id", { count: "exact", head: true })
          .eq("gallery_id", gallery.id),
      ]);
      const bucket = supabase.storage.from("gallery-previews");
      photos = (images ?? [])
        .filter((img) => img.thumbnail_key && img.preview_key)
        .map((img, i) => ({
          id: img.id as string,
          thumbUrl: bucket.getPublicUrl(img.thumbnail_key as string).data.publicUrl,
          previewUrl: bucket.getPublicUrl(img.preview_key as string).data.publicUrl,
          alt: (img.caption as string | null) || `Karl Ray Photography, photo ${i + 1}`,
        }));
      photoCount = count ?? photos.length;
    }

    return {
      avatarUrl: (profile?.avatar_url as string | null) ?? null,
      bannerUrl: (profile?.banner_url as string | null) ?? null,
      bio: (profile?.bio as string | null) ?? null,
      galleryId: (gallery?.id as string | undefined) ?? null,
      photos,
      photoCount,
    };
  } catch (err) {
    console.error("karlray profile load error", err);
    return empty;
  }
}

// First book of each series, so the shelf shows the range at a glance.
const BOOK_SHELF = BOOK_SERIES.map((s) => s.books[0]!).filter(
  (b) => coverUrlFor(b) && bookUrlFor(b),
);

function SectionHeading({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
        <span className="text-brand-primary">{icon}</span>
        {title}
      </h2>
      {action}
    </div>
  );
}

export default async function KarlRayProfilePage() {
  const data = await getProfileData();

  return (
    <div className="bg-brand-background text-text-primary">
      {/* Banner */}
      <div className="relative h-44 w-full sm:h-64">
        <CoverImage
          src={data.bannerUrl}
          alt="Karl Ray banner"
          name="Karl Ray"
          rounded="rounded-none"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-brand-background" />
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Header */}
        <header className="relative -mt-16 flex flex-col items-center text-center sm:-mt-20 sm:flex-row sm:items-end sm:gap-6 sm:text-left">
          <CoverImage
            src={data.avatarUrl}
            alt="Karl Ray"
            name="Karl Ray"
            rounded="rounded-full"
            className="h-32 w-32 shrink-0 border-4 border-brand-background object-cover sm:h-40 sm:w-40"
          />
          <div className="mt-3 flex-1 sm:mb-2">
            <h1 className="text-3xl font-bold sm:text-4xl">Karl Ray</h1>
            <p className="mt-1 text-text-secondary">
              Author · Musician · Photographer · Founder of Melori · Chicago
            </p>
          </div>
          <div className="mt-3 sm:mb-3">
            <ShareButton
              url={`${SITE_URL}${KARL_PROFILE_PATH}`}
              title="Karl Ray"
              text="Books, music and photography by Karl Ray, founder of Melori."
              label="Share Karl Ray's page"
            />
          </div>
        </header>

        {/* Support line — accurate on purpose: Melori itself sells nothing
            (see the mission). The money goes to Karl, and Karl funds Melori. */}
        <div className="mt-6 rounded-2xl border border-brand-primary/40 bg-brand-primary/10 p-4 sm:p-5">
          <p className="flex gap-3 text-sm leading-relaxed sm:text-base">
            <Heart className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
            <span>
              <span className="font-semibold">Every book you buy and every song you stream supports Karl
              &mdash; and Karl is the one funding Melori.</span>{" "}
              <span className="text-text-secondary">
                It&apos;s how this platform stays free for every artist on it.
              </span>
            </span>
          </p>
        </div>

        {/* Main actions */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <a
            href={BOOKS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl bg-brand-primary px-5 py-4 text-center font-bold text-white transition-transform hover:bg-brand-primary-dark active:scale-[0.98]"
          >
            Get the Books
          </a>
          <a
            href={RELAUNCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-brand-border bg-brand-surface px-5 py-4 text-center font-bold transition-transform hover:border-brand-primary active:scale-[0.98]"
          >
            Listen to RELAUNCH
          </a>
          <a
            href="#photos"
            className="rounded-2xl border border-brand-border bg-brand-surface px-5 py-4 text-center font-bold transition-transform hover:border-brand-primary active:scale-[0.98]"
          >
            See the Photos
          </a>
        </div>

        {data.bio && (
          <p className="mt-6 text-lg leading-relaxed text-text-secondary">{data.bio}</p>
        )}

        {/* Books */}
        <section className="mt-10" id="books">
          <SectionHeading
            icon={<BookOpen className="h-5 w-5" />}
            title="Books"
            action={
              <Link href="/books" className="text-sm text-brand-primary hover:underline">
                Every book →
              </Link>
            }
          />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {BOOK_SHELF.map((b) => (
              <a
                key={b.title}
                href={bookUrlFor(b)!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${b.title} (opens the book's store page)`}
                className="group block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverUrlFor(b)!}
                  alt={b.title}
                  loading="lazy"
                  className="aspect-[2/3] w-full rounded-md object-cover transition-transform group-hover:-translate-y-1"
                />
              </a>
            ))}
          </div>
        </section>

        {/* Music */}
        <section className="mt-10" id="music">
          <SectionHeading icon={<Headphones className="h-5 w-5" />} title="Music" />
          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href={RELAUNCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-brand-border bg-brand-surface p-4 hover:border-brand-primary"
            >
              <span className="block font-bold">RELAUNCH</span>
              <span className="block text-sm text-text-secondary">The album, on Amazon Music</span>
            </a>
            <Link
              href={KARL_ARTIST_PATH}
              className="rounded-2xl border border-brand-border bg-brand-surface p-4 hover:border-brand-primary"
            >
              <span className="block font-bold">Karl Ray on Melori</span>
              <span className="block text-sm text-text-secondary">Songs and releases</span>
            </Link>
          </div>
        </section>

        {/* Shows — the same list as /links (src/lib/channels.ts). */}
        <section className="mt-10 scroll-mt-24" id="shows">
          <SectionHeading icon={<Tv className="h-5 w-5" />} title="Shows" />
          <ChannelLinks showGroups={false} />
        </section>

        {/* Photography */}
        <section className="mt-10 scroll-mt-24" id="photos">
          <SectionHeading
            icon={<Camera className="h-5 w-5" />}
            title="Photography"
            action={
              data.galleryId ? (
                <OwnerUpload ownerId={KARL_PROFILE_ID} galleryId={data.galleryId} />
              ) : undefined
            }
          />
          <PortfolioGrid photos={data.photos} />
          {data.photoCount > data.photos.length && (
            <Link
              href={PORTFOLIO_URL}
              className="mt-4 block rounded-2xl border border-brand-border bg-brand-surface px-5 py-3 text-center font-semibold hover:border-brand-primary"
            >
              See all {data.photoCount} photos
            </Link>
          )}
        </section>
      </div>

      {/* The mission, moved here from /mission (Karl, 2026-10-17). */}
      <div className="mt-16">
        <MissionStatement />
        <NameMeaning variant="full" />
        <section className="border-t border-brand-border">
          <div className="mx-auto max-w-2xl px-6 py-16">
            <div className="mb-8 text-center">
              <h2 className="mb-3 text-3xl font-bold">Help us improve</h2>
              <p className="text-lg text-text-secondary">
                We&apos;re building Melori in the open. Tell us what&apos;s working, what
                isn&apos;t, or what you&apos;d love to see next.
              </p>
            </div>
            <HelpUsImprove />
          </div>
        </section>
      </div>
    </div>
  );
}
