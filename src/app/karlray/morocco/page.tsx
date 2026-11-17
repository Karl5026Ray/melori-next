import Link from "next/link";
import type { Metadata } from "next";
import { Heart, MapPin } from "lucide-react";
import ShareButton from "@/components/ShareButton";
import { getSupabaseCatalogReader } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import {
  KARL_PROFILE_ID,
  KARL_PROFILE_PATH,
  MOROCCO_GALLERY_SLUG,
  MOROCCO_PATH,
  MOROCCO_SUPPORT_URL,
  RELAUNCH_URL,
} from "@/lib/karlray";
import OwnerUpload from "../OwnerUpload";
import TripFeed, { type TripPost } from "./TripFeed";

// Morocco trip updates (Karl, 2026-11-17: "get the Morocco trip with a Melori
// link to keep it posted"). The trip's support page links here.
//
// Each update is a photo in the morocco-trip-2026 gallery; its caption is the
// update text. Karl posts from his phone with the same "Add photos" button as
// /karlray, and writes the caption under the photo right on this page.
//
// Public (PUBLIC_EXACT in src/proxy.ts) and ISR, not force-dynamic, for the
// same reason as /karlray: in-app browsers discard `no-store` pages.
export const revalidate = 60;

const TRIP_START = new Date("2026-12-16T00:00:00-06:00");
const TRIP_END = new Date("2027-01-07T00:00:00-06:00");
const POST_LIMIT = 60;

const description =
  "Karl Ray's Christmas trip to Morocco: photos, updates and first listens to the songs he writes there.";

export const metadata: Metadata = {
  title: "Morocco Trip",
  description,
  alternates: { canonical: `${SITE_URL}${MOROCCO_PATH}` },
  openGraph: { title: "Morocco Trip", description, images: ["/images/og-image.png"] },
};

async function getTrip(): Promise<{ galleryId: string | null; posts: TripPost[] }> {
  try {
    // Cached reader, not getSupabaseAdmin(): its no-store reads would make
    // this route dynamic despite `revalidate`, and in-app browsers discard
    // no-store pages. The feed is public and the same for every visitor.
    const supabase = getSupabaseCatalogReader();
    const { data: gallery } = await supabase
      .from("photo_galleries")
      .select("id")
      .eq("slug", MOROCCO_GALLERY_SLUG)
      .eq("is_active", true)
      .maybeSingle();
    if (!gallery?.id) return { galleryId: null, posts: [] };

    const { data: images } = await supabase
      .from("photo_gallery_images")
      .select("id, preview_key, thumbnail_key, caption, created_at")
      .eq("gallery_id", gallery.id)
      .order("created_at", { ascending: false })
      .limit(POST_LIMIT);

    const bucket = supabase.storage.from("gallery-previews");
    const posts = (images ?? [])
      .filter((img) => img.preview_key)
      .map((img) => ({
        id: img.id as string,
        imageUrl: bucket.getPublicUrl(img.preview_key as string).data.publicUrl,
        caption: (img.caption as string | null) ?? null,
        createdAt: img.created_at as string,
      }));
    return { galleryId: gallery.id as string, posts };
  } catch (err) {
    console.error("morocco trip load error", err);
    return { galleryId: null, posts: [] };
  }
}

function tripStatus(now: Date): string {
  if (now < TRIP_START) {
    const days = Math.ceil((TRIP_START.getTime() - now.getTime()) / 86_400_000);
    return days === 1 ? "Leaving tomorrow" : `${days} days until we leave`;
  }
  if (now < TRIP_END) return "In Morocco now";
  return "Home again. Thank you for following along";
}

export default async function MoroccoTripPage() {
  const { galleryId, posts } = await getTrip();
  const status = tripStatus(new Date());

  return (
    <div className="bg-brand-background text-text-primary">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link href={KARL_PROFILE_PATH} className="text-sm text-brand-primary hover:underline">
          ← Karl Ray
        </Link>

        <header className="mt-4">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-primary">
            <MapPin className="h-4 w-4" aria-hidden /> {status}
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Christmas in Morocco</h1>
          <p className="mt-1 text-text-secondary">December 16, 2026 – January 6, 2027</p>
          <p className="mt-4 text-lg leading-relaxed text-text-secondary">
            Karl and his fiancée Blessing are spending Christmas in Marrakech. Photos,
            updates and first listens to the songs Karl writes there go up here first.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href={MOROCCO_SUPPORT_URL}
              className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-5 py-2.5 font-semibold text-white hover:bg-brand-primary-dark"
            >
              <Heart className="h-4 w-4" aria-hidden /> Support the trip
            </a>
            <a
              href={RELAUNCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-brand-border bg-brand-surface px-5 py-2.5 font-semibold hover:border-brand-primary"
            >
              Listen to RELAUNCH
            </a>
            <ShareButton
              url={`${SITE_URL}${MOROCCO_PATH}`}
              title="Christmas in Morocco"
              text="Follow Karl and Blessing's Christmas trip to Morocco on Melori."
              label="Share the trip"
            />
          </div>
        </header>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold sm:text-2xl">Updates</h2>
            {galleryId && <OwnerUpload ownerId={KARL_PROFILE_ID} galleryId={galleryId} />}
          </div>
          {posts.length === 0 ? (
            <p className="rounded-2xl border border-brand-border bg-brand-surface p-5 text-text-secondary">
              The first photos go up when the trip starts. Check back December 16.
            </p>
          ) : (
            <TripFeed ownerId={KARL_PROFILE_ID} posts={posts} />
          )}
        </section>

        <div className="mt-12 rounded-2xl border border-brand-primary/40 bg-brand-primary/10 p-5 text-center">
          <p className="font-semibold">Get the updates as they happen</p>
          <p className="mt-1 text-sm text-text-secondary">
            Join Melori free. Your profile is ready the moment you sign up.
          </p>
          <Link
            href="/register"
            className="mt-4 inline-block rounded-full bg-brand-primary px-5 py-2.5 font-semibold text-white hover:bg-brand-primary-dark"
          >
            Join Melori free
          </Link>
        </div>
      </div>
    </div>
  );
}
