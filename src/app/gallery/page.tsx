import Link from "next/link";
import type { Metadata } from "next";
import { Camera, Lock, Download, ShoppingBag } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gallery | Melori Music",
  description:
    "Photo galleries by Melori Music — view, download, and purchase prints from your shoot.",
};

interface GalleryCard {
  slug: string;
  name: string;
  clientName: string | null;
  coverUrl: string | null;
  imageCount: number;
  locked: boolean;
}

async function getPublicGalleries(): Promise<GalleryCard[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: galleries, error } = await supabase
      .from("photo_galleries")
      .select("id, slug, name, client_name, cover_image_key, password_hash")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error || !galleries) return [];

    return await Promise.all(
      galleries.map(async (g) => {
        // Prefer the explicit cover; otherwise fall back to the first image's
        // watermarked thumbnail so the card is never blank.
        let coverKey = g.cover_image_key as string | null;
        if (!coverKey) {
          const { data: first } = await supabase
            .from("photo_gallery_images")
            .select("thumbnail_key")
            .eq("gallery_id", g.id)
            .order("order_index", { ascending: true })
            .limit(1)
            .maybeSingle();
          coverKey = first?.thumbnail_key ?? null;
        }
        const coverUrl = coverKey
          ? supabase.storage.from("gallery-previews").getPublicUrl(coverKey).data
              .publicUrl
          : null;

        const { count } = await supabase
          .from("photo_gallery_images")
          .select("id", { count: "exact", head: true })
          .eq("gallery_id", g.id);

        return {
          slug: g.slug,
          name: g.name,
          clientName: g.client_name,
          coverUrl,
          imageCount: count ?? 0,
          locked: Boolean(g.password_hash),
        };
      }),
    );
  } catch (err) {
    console.error("gallery index list error", err);
    return [];
  }
}

export default async function GalleryIndexPage() {
  const galleries = await getPublicGalleries();

  return (
    <main className="min-h-screen bg-brand-background text-text-primary">
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
            <Camera className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Gallery</h1>
            <p className="text-sm text-text-secondary">
              Photography by Melori Music
            </p>
          </div>
        </div>

        <p className="mt-6 max-w-2xl text-text-secondary">
          Browse delivered photo galleries. Open your gallery to view every
          frame, download your favorites, and purchase high-resolution digital
          copies. You can also reach this page any time from the M-menu under{" "}
          <span className="text-text-primary">Photography &rarr; Gallery</span>.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<Lock className="h-5 w-5" />}
            title="Private & secure"
            body="Password-protected galleries keep client work private."
          />
          <Feature
            icon={<Download className="h-5 w-5" />}
            title="Instant downloads"
            body="Grab clean, full-resolution files the moment they're ready."
          />
          <Feature
            icon={<ShoppingBag className="h-5 w-5" />}
            title="Buy digital copies"
            body="Purchase watermark-free digital downloads securely via Stripe."
          />
        </div>

        {galleries.length > 0 ? (
          <>
            <h2 className="mt-14 mb-4 text-lg font-semibold">
              Recent galleries
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {galleries.map((g) => (
                <Link
                  key={g.slug}
                  href={`/gallery/${g.slug}`}
                  className="group overflow-hidden rounded-xl border border-brand-border bg-brand-surface transition-colors hover:border-brand-primary"
                >
                  <div className="relative aspect-square overflow-hidden bg-brand-muted">
                    {g.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.coverUrl}
                        alt={g.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-brand-primary">
                        <Camera className="h-8 w-8" />
                      </div>
                    )}
                    {g.locked && (
                      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-brand-background/80 px-2 py-1 text-[10px] font-semibold text-text-primary">
                        <Lock className="h-3 w-3" /> Private
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-semibold">{g.name}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {g.clientName ? `${g.clientName} · ` : ""}
                      {g.imageCount} photo{g.imageCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-14 rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <Camera className="mx-auto h-10 w-10 text-brand-primary" />
            <p className="mt-3 font-semibold">No galleries yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Delivered galleries will appear here. Have a link? Open it directly
              at{" "}
              <span className="text-text-primary">/gallery/your-gallery</span>.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
        {icon}
      </span>
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{body}</p>
    </div>
  );
}
