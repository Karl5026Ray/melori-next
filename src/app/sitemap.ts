import type { MetadataRoute } from "next";
import { getReleases, getArtists } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

// Built from the same published-only data layer the catalog pages use, so the
// sitemap only ever lists releases/artists that are live on the site.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [releases, artists] = await Promise.all([
    getReleases().catch(() => []),
    getArtists().catch(() => []),
  ]);

  const now = new Date();

  // Public, indexable routes. Admin/dashboard/settings and per-user social
  // pages are excluded intentionally (see robots.ts).
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,                    lastModified: now, changeFrequency: "daily",   priority: 1.0 },
    { url: `${SITE_URL}/music`,               lastModified: now, changeFrequency: "daily",   priority: 0.9 },
    { url: `${SITE_URL}/artists`,             lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${SITE_URL}/featured-artist`,     lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    { url: `${SITE_URL}/video`,               lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    { url: `${SITE_URL}/store`,               lastModified: now, changeFrequency: "daily",   priority: 0.8 },
    { url: `${SITE_URL}/membership`,          lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${SITE_URL}/mission`,             lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/support`,             lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/donate`,              lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`,             lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${SITE_URL}/terms`,               lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    // Social entry points that are safe to index (auth landing + public listings).
    { url: `${SITE_URL}/social/auth`,         lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/social/spaces`,       lastModified: now, changeFrequency: "hourly",  priority: 0.6 },
    { url: `${SITE_URL}/social/community`,    lastModified: now, changeFrequency: "hourly",  priority: 0.6 },
    { url: `${SITE_URL}/social/video`,        lastModified: now, changeFrequency: "daily",   priority: 0.5 },
  ];

  const releaseRoutes: MetadataRoute.Sitemap = releases.map((release) => ({
    url: `${SITE_URL}/albums/${release.slug}`,
    lastModified: release.release_date ? new Date(release.release_date) : now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const artistRoutes: MetadataRoute.Sitemap = artists.map((artist) => ({
    url: `${SITE_URL}/artists/${artist.slug}`,
    lastModified: artist.updated_at ? new Date(artist.updated_at) : now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...releaseRoutes, ...artistRoutes];
}
