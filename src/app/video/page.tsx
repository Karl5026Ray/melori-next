import type { Metadata } from "next";
import { getSupabaseCatalogReader } from "@/lib/supabase/admin";

// ISR instead of `dynamic = 'force-dynamic'` — see issue #280 and the longer
// note in src/lib/supabase/admin.ts.
//
// force-dynamic (plus the old revalidate = 0) made Next.js stamp `no-store` on
// the HTML response, which iOS WKWebView wrapper browsers refuse to render. On
// Vercel that function-set header cannot be overridden by next.config.js or
// src/proxy.ts.
//
// Safe here for the same reason as / and /music: the video list is read
// through getSupabaseCatalogReader() and is identical for every visitor —
// there is no viewer-entitlement filtering on this query.
export const revalidate = 60;

const description =
  "Watch the official music videos and visuals from MELORI Music artists, plus the REFLECT series.";

export const metadata: Metadata = {
  title: "Videos",
  description,
  openGraph: {
    title: "Videos",
    description,
    images: ["/images/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Videos",
    description,
    images: ["/images/og-image.png"],
  },
};

interface VideoRow {
  id: number;
  youtube_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  views: number;
  sort_order: number;
  series: string | null;
  is_vertical: boolean;
}

async function getVideos(): Promise<VideoRow[]> {
  const supabase = getSupabaseCatalogReader();
  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, youtube_id, title, description, thumbnail_url, published_at, views, sort_order, series, is_vertical"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getVideos error", error);
    return [];
  }
  return (data as VideoRow[]) ?? [];
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// "Without The Blacks EP 1 - Garrett Morgan | REFLECT Series" -> "EP 1 - Garrett Morgan"
// Series tiles sit under their own heading, so repeating the series name on
// every card is noise. Falls back to the full title if it isn't shaped that way.
function episodeLabel(title: string): string {
  return (
    title
      .replace(/^Without The Blacks\s+/i, "")
      .replace(/\s*\|\s*REFLECT Series\s*$/i, "")
      .trim() || title
  );
}

function Embed({ youtubeId, title }: { youtubeId: string; title: string }) {
  return (
    <iframe
      className="absolute inset-0 h-full w-full"
      src={`https://www.youtube.com/embed/${youtubeId}`}
      title={title}
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}

export default async function VideoPage() {
  const videos = await getVideos();

  // Vertical shorts never take the 16:9 featured slot — a 9:16 clip letterboxed
  // across the top of the page reads as a broken embed.
  const wide = videos.filter((v) => !v.is_vertical);
  const vertical = videos.filter((v) => v.is_vertical);

  const featured = wide[0];
  const rest = wide.slice(1);

  // Group the vertical shorts by their series label, preserving sort_order.
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, VideoRow[]>();
  for (const v of vertical) {
    const key = v.series?.trim() || "Shorts";
    if (!bySeries.has(key)) {
      bySeries.set(key, []);
      seriesOrder.push(key);
    }
    bySeries.get(key)!.push(v);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold">Videos</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Official music videos and visuals from MELORI Music artists.
      </p>

      {videos.length === 0 ? (
        <p className="text-text-secondary">No videos published yet.</p>
      ) : (
        <>
          {featured && (
            <section className="mb-12">
              <div
                className="relative w-full overflow-hidden rounded-lg bg-black"
                style={{ paddingTop: "56.25%" }}
              >
                <Embed youtubeId={featured.youtube_id} title={featured.title} />
              </div>
              <h2 className="mt-4 text-xl font-semibold">{featured.title}</h2>
              <p className="text-sm text-text-secondary">
                {formatViews(featured.views)} views
                {featured.published_at ? ` · ${featured.published_at}` : ""}
              </p>
            </section>
          )}

          {seriesOrder.map((name) => {
            const episodes = bySeries.get(name) ?? [];
            return (
              <section key={name} className="mb-12">
                <h3 className="text-xl font-semibold mb-1">{name}</h3>
                <p className="mb-4 text-sm text-text-secondary">
                  {episodes.length} episode{episodes.length === 1 ? "" : "s"} · vertical shorts
                </p>
                {/* 9:16 frames. More columns than the wide grid because each
                    tile is narrow — 2 up on phones, 5 on desktop. */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {episodes.map((v) => (
                    <article key={v.id} className="flex flex-col">
                      <div
                        className="relative w-full overflow-hidden rounded-md bg-black"
                        style={{ paddingTop: "177.78%" }}
                      >
                        <Embed youtubeId={v.youtube_id} title={v.title} />
                      </div>
                      <h4 className="mt-3 text-sm font-medium leading-snug">
                        {episodeLabel(v.title)}
                      </h4>
                      <p className="text-xs text-text-secondary">
                        {formatViews(v.views)} views
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}

          {rest.length > 0 && (
            <section>
              <h3 className="text-xl font-semibold mb-4">More videos</h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((v) => (
                  <article key={v.id} className="flex flex-col">
                    <div
                      className="relative w-full overflow-hidden rounded-md bg-black"
                      style={{ paddingTop: "56.25%" }}
                    >
                      <Embed youtubeId={v.youtube_id} title={v.title} />
                    </div>
                    <h4 className="mt-3 text-sm font-medium leading-snug">
                      {v.title}
                    </h4>
                    <p className="text-xs text-text-secondary">
                      {formatViews(v.views)} views
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
