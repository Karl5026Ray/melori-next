import type { Metadata } from "next";
import MusicPageClient from "@/components/MusicPageClient";
import { getReleases } from "@/lib/data";
import { getCatalogItems } from "@/lib/catalog";

// ISR instead of `dynamic = 'force-dynamic'` — see issue #280 and the longer
// note in src/app/page.tsx.
//
// force-dynamic made Next.js stamp `no-store` on the HTML response, which iOS
// WKWebView wrapper browsers refuse to render. On Vercel that function-set
// header cannot be overridden by next.config.js or src/proxy.ts.
//
// Safe here for the same reason as the homepage: the catalog is read through
// `getSupabaseAdmin()` and is identical for every visitor, with auth state
// resolved client-side.
export const revalidate = 60;

const description =
  "Browse every release on MELORI Music — singles, EPs, and albums from independent artists.";

export const metadata: Metadata = {
  title: "Music Catalog",
  description,
  openGraph: {
    title: "Music Catalog",
    description,
    images: ["/images/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Music Catalog",
    description,
    images: ["/images/og-image.png"],
  },
};

export default async function MusicPage() {
  // One catalog: admin-curated releases and artist self-uploads together.
  // getCatalogItems swallows a studio-side failure so a partial outage
  // degrades the list rather than blanking the page.
  const releases = await getReleases().catch(() => []);
  const items = await getCatalogItems(releases);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold">Music Catalog</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Browse every release on MELORI Music.
      </p>
      <MusicPageClient items={items} />
    </div>
  );
}
