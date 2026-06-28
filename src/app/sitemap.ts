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

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/music`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/artists`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
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
