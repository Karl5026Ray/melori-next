import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Keep authenticated/administrative surfaces out of the index. Everything else
// under `/` is fair game and covered by /sitemap.xml.
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
          "/social/messages",
          "/social/profile",
          "/download-success",
          "/membership-success",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
