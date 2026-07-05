// Approve the request's origin for use in return URLs (Stripe success/cancel,
// email links, etc.). Anything not on the whitelist falls back to the
// canonical production origin so an attacker can't set `Origin: attacker.com`
// on a checkout request and get Stripe's post-payment handoff sent there.

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
