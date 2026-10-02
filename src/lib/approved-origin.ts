// Approve the request's origin for use in return URLs (OAuth callbacks, email
// links, shareable gallery URLs, etc.). Anything not on the whitelist falls
// back to the canonical production origin so an attacker can't set
// `Origin: attacker.com` on a request and get a redirect or link pointed there.

const APPROVED_HOSTS = new Set<string>([
  "melorimusic.org",
  "www.melorimusic.org",
  "melori-next.vercel.app",
]);

const FALLBACK_ORIGIN = "https://melorimusic.org";

export function approvedOrigin(req: Request): string {
  const raw =
    req.headers.get("origin") ||
    (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
  if (!raw) return FALLBACK_ORIGIN;
  try {
    const u = new URL(raw);
    if (
      (u.protocol === "https:" || u.hostname === "localhost") &&
      (APPROVED_HOSTS.has(u.hostname) || u.hostname.endsWith(".vercel.app"))
    ) {
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_ORIGIN;
}
