import type { MetadataRoute } from "next";
import { getStudioAlbumBySlug } from "@/lib/catalog";
import { getArtists, getReleases } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

// Built from the same published-only data layer the catalog pages use, so the
// sitemap only ever lists artists who are live on the site.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [artists, releases, studioAlbums] = await Promise.all([
    getArtists().catch(() => []),
    getReleases().catch(() => []),
    publicStudioAlbumSlugs().catch(() => [] as string[]),
  ]);

  const now = new Date();

  // Public, indexable routes.
  //
  // This list used to include /music, /store, /connect, /membership, /donate,
  // /video and three /social pages. Since the signup wall those all redirect a
  // signed-out visitor — including Googlebot — to the door, so listing them was
  // sending the crawler to fetch the same signup page a dozen times over and
  // telling it those URLs were content. They are gone.
  //
  // What is left is what a stranger can actually read: Karl's photography, his
  // introduction, the four live surfaces described on their own public pages,
  // the artist profiles, and the obligations. Release and artist detail pages
  // are appended below.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,          lastModified: now, changeFrequency: "daily",   priority: 1.0 },
    { url: `${SITE_URL}/gallery`,   lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    // Karl's introduction, which now carries the mission. Listed at its real
    // URL: /about and /mission redirect to it, and a sitemap
    // entry that redirects tells Google to index a URL that is not the page.
    { url: `${SITE_URL}/karlray`,   lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${SITE_URL}/links`,     lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/books`,     lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/catalog`,   lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/artists`,   lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    // The live surfaces, as public pages rather than the members-only rooms.
    { url: `${SITE_URL}/faces`,     lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/spaces`,    lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/cinema`,    lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/radio`,     lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/register`,  lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/android`,   lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/support`,   lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`,   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${SITE_URL}/terms`,     lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];

  // Album pages are public again since 2026-10-15 (see src/proxy.ts), so they
  // are listed. Artist profiles stay public deliberately: gating them would have hidden
  // Kaiel R and Gloria Joy Rivers from search.
  const artistRoutes: MetadataRoute.Sitemap = artists.map((artist) => ({
    url: `${SITE_URL}/artists/${artist.slug}`,
    lastModified: artist.updated_at ? new Date(artist.updated_at) : now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const releaseRoutes: MetadataRoute.Sitemap = releases.map((release) => ({
    url: `${SITE_URL}/albums/${release.slug}`,
    lastModified: release.release_date ? new Date(release.release_date) : now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  const studioAlbumRoutes: MetadataRoute.Sitemap = studioAlbums.map((slug) => ({
    url: `${SITE_URL}/music/album/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...artistRoutes, ...releaseRoutes, ...studioAlbumRoutes];
}

// Only albums that actually render: getStudioAlbumBySlug 404s an album with
// nothing published behind it, and a sitemap must not list a 404.
async function publicStudioAlbumSlugs(): Promise<string[]> {
  const { data } = await getSupabaseAdmin()
    .from("studio_albums")
    .select("slug")
    .not("slug", "is", null)
    .limit(200);
  const slugs = ((data as { slug: string }[] | null) ?? []).map((r) => r.slug);
  const live = await Promise.all(
    slugs.map(async (slug) => ((await getStudioAlbumBySlug(slug).catch(() => null)) ? slug : null)),
  );
  return live.filter((s): s is string => s !== null);
}
