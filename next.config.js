/** @type {import('next').NextConfig} */
//
// melori-next/next.config.js
//
// PURPOSE: Bridge the public Vercel front (melorimusic.org) to the VPS Express
// API for the routes that only exist on the VPS (members, purchases, downloads).
//
// IMPORTANT: We do NOT proxy ALL /api/* — melori-next has its own route handlers
// for /api/releases, /api/artists, /api/tracks that read Supabase. Those must
// stay local. Only the VPS-owned auth & commerce surfaces get rewritten.
//
// This is the minimum-viable bridge to:
//   1. Close Gate #28 (password reset deliverability test)
//   2. Unblock Stripe Checkout from the public site
//
// Longer-term: migrate members → Supabase Auth so melori-next owns everything.
// Tracked separately. For now, VPS remains source of truth for users + purchases.

const VPS_ORIGIN = process.env.VPS_API_ORIGIN || 'http://160.153.186.249:5000';

// Baseline security headers applied to every route. We deliberately leave the
// Content-Security-Policy off for now because a wrong CSP would break Stripe
// Checkout, Supabase realtime, and Agora WebRTC — that needs a staging pass
// before we lock it in. Everything else here is safe defaults.
const SECURITY_HEADERS = [
  // Force HTTPS for a year across the apex + subdomains once the browser has
  // seen this header. `preload` is intentionally omitted until we're sure we
  // want to submit to the HSTS preload list.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Don't let anyone iframe the app — protects against clickjacking on the
  // sign-in / checkout / studio surfaces.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't sniff response bodies to guess the MIME type. Belt-and-suspenders
  // against "user uploads a .jpg that's actually HTML with a script tag".
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only send the origin (not the full path/query) on cross-origin nav — keeps
  // conversation IDs and space IDs out of Referer on outbound links.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny access to sensitive browser features we don't use. Camera + microphone
  // are needed for Agora voice/video rooms, so we allow same-origin for those.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=(self), usb=(), interest-cohort=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Image optimizer allowlist. Narrow on purpose: only the Supabase public
  // storage host that actually serves Melori cover/artwork URLs. This unblocks
  // migrating components to next/image incrementally WITHOUT a broad wildcard
  // (a wildcard would let the optimizer be pointed at arbitrary hosts, which is
  // a cost/security footgun). Add more specific hosts here only as needed.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'ouvovhwizsuhjxxmccex.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        // Apply to every route including API handlers.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // Friendly-URL redirects for well-known aliases users type in the address bar.
  // Site-evaluation P1 fix (2026-07-04): these previously 404'd.
  async redirects() {
    return [
      // ── Canonical origin: force www.melorimusic.org → melorimusic.org (apex).
      //
      // WHY: Supabase auth (browser client, PKCE flow) stores the OAuth
      // `code_verifier` in localStorage, which is scoped per-origin. If a user
      // starts "Continue with Google" on www.melorimusic.org and Google
      // redirects them back to melorimusic.org (or vice versa), the callback
      // page can't find the verifier and Supabase throws:
      //   "PKCE code verifier not found in storage."
      // Pinning every request to the apex origin eliminates that class of
      // sign-in failure. Must be `permanent: true` so browsers cache the
      // redirect and Google/Stripe/etc. see a stable canonical origin.
      //
      // Follow-up (do these AFTER this ships):
      //   1. In Supabase → Authentication → URL Configuration, remove any
      //      www.melorimusic.org entries from the Redirect URL allowlist so
      //      only https://melorimusic.org/auth/callback remains.
      //   2. In Google Cloud Console → OAuth 2.0 Client → Authorized redirect
      //      URIs, keep only the Supabase callback URL (that never changes),
      //      but confirm Authorized JavaScript Origins lists only the apex.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.melorimusic.org' }],
        destination: 'https://melorimusic.org/:path*',
        permanent: true,
      },

      { source: '/login',     destination: '/social/auth',   permanent: false },
      { source: '/clubhouse', destination: '/social/spaces', permanent: false },
      { source: '/about',     destination: '/mission',       permanent: true  },
      { source: '/artist',    destination: '/artists',       permanent: true  },
      { source: '/members',   destination: '/membership',    permanent: true  },
      // Kimi also flagged /portal — safest landing for that is auth.
      { source: '/portal',    destination: '/social/auth',   permanent: false },
      // Releases live under /albums/[slug]; /releases/* previously 404'd.
      { source: '/releases/:slug', destination: '/albums/:slug', permanent: true },
      { source: '/releases',       destination: '/music',       permanent: true },
    ];
  },
  async rewrites() {
    return [
      // ── Stripe success_url backwards-compat: VPS still sends Stripe a
      // success_url ending in .html (download-success.html, membership-success.html).
      // Next.js routes are extensionless. Rewrite the .html variants to the
      // real routes so old Stripe sessions keep working without a VPS change.
      {
        source: '/download-success.html',
        destination: '/download-success',
      },
      {
        source: '/membership-success.html',
        destination: '/membership-success',
      },
      // ── Members / auth (sign-in, sign-up, sessions, password reset, profile)
      // NOTE: /api/members/stripe-webhook is now owned by a LOCAL Next.js route
      // handler (src/app/api/members/stripe-webhook/route.ts) — migrated off the
      // VPS because the VPS handler had a raw-body bug that failed every Stripe
      // signature check. Default rewrites are `afterFiles`, so the filesystem
      // route already wins over this catch-all; we intentionally do NOT proxy it.
      {
        source: '/api/members/:path((?!stripe-webhook$).*)',
        destination: `${VPS_ORIGIN}/api/members/:path`,
      },
      // ── Purchases (Stripe Checkout sessions, order lookup)
      {
        source: '/api/purchase/:path*',
        destination: `${VPS_ORIGIN}/api/purchase/:path*`,
      },
      // ── Downloads (post-purchase secure file delivery)
      {
        source: '/api/download/:path*',
        destination: `${VPS_ORIGIN}/api/download/:path*`,
      },
      // ── Artist tools (uploads, dashboards) — VPS-only
      {
        source: '/api/artist/:path*',
        destination: `${VPS_ORIGIN}/api/artist/:path*`,
      },
      // NOTE: /api/releases, /api/artists, /api/tracks are NOT rewritten —
      // those are Next.js route handlers in src/app/api/ that read Supabase
      // directly. Do not add a catch-all /api/:path* rewrite or those will
      // break.
    ];
  },
};

module.exports = nextConfig;
