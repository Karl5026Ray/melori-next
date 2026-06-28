// Absolute base URL for the site, used by metadataBase, the sitemap, and robots
// so Open Graph and canonical URLs resolve to a real host. Production resolves to
// melorimusic.org; Vercel previews set NEXT_PUBLIC_APP_URL to their alias.
export const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://melorimusic.org";
