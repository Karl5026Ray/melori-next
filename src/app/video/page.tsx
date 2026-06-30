import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const description =
  "Watch the official music videos and visuals from MELORI Music artists.";

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
}

async function getVideos(): Promise<VideoRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, youtube_id, title, description, thumbnail_url, published_at, views, sort_order"
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

export default async function VideoPage() {
  const videos = await getVideos();
  const featured = videos[0];
  const rest = videos.slice(1);

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
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src={`https://www.youtube.com/embed/${featured.youtube_id}`}
                  title={featured.title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <h2 className="mt-4 text-xl font-semibold">{featured.title}</h2>
              <p className="text-sm text-text-secondary">
                {formatViews(featured.views)} views
                {featured.published_at ? ` · ${featured.published_at}` : ""}
              </p>
            </section>
          )}

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
                      <iframe
                        className="absolute inset-0 h-full w-full"
                        src={`https://www.youtube.com/embed/${v.youtube_id}`}
                        title={v.title}
                        loading="lazy"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
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
