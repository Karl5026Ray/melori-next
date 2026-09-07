import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Keep authenticated surfaces out of the index.
//
// Since the signup wall, most of the site answers a signed-out visitor — and
// Googlebot is always a signed-out visitor — with a redirect to the door. There
// is nothing there for a crawler to read, so pointing it at those paths only
// burns crawl budget on the same signup page.
//
// The public surface is small and deliberate: the photography, Karl's
// introduction, the four pages describing the live rooms, the artist profiles,
// and the obligations. Those are what /sitemap.xml lists.
//
// No Googlebot special-casing anywhere: the public pages are public to
// everyone, so a crawler and a person see exactly the same thing. Serving the
// crawler something a person cannot see is cloaking, and Google's spam policies
// are explicit about it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/api/",
          "/dashboard",
          "/settings",
          "/upload",
          "/studio",
          "/account",
          "/onboarding",
          // The members-only app. The public pages describing these rooms are
          // /faces, /spaces, /cinema and /radio.
          "/social/",
          "/music",
          "/albums",
          "/video",
          "/connect",
          "/featured-artist",
          "/download-success",
          "/membership-success",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
