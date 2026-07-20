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

// Staging-safe Content-Security-Policy. We ship it as *Report-Only* first: the
// browser evaluates it and reports violations but NEVER blocks anything, so it
// cannot break Stripe Checkout, Supabase realtime, LiveKit/Agora WebRTC, PubNub
// presence, or Google OAuth. Watch the browser console / a report endpoint for
// a few days, confirm zero legitimate violations, then flip the header key to
// "Content-Security-Policy" (enforcing) in a follow-up PR.
//
// Sources reflect Melori's real providers:
//   supabase.co (auth/db/storage/realtime), stripe.com/js.stripe.com (checkout),
//   *.livekit.cloud + wss (audio/video), *.agora.io (legacy voice),
//   *.pubnub.com (presence), google/gstatic (OAuth + fonts).
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next.js requires 'unsafe-inline'/'unsafe-eval' for its runtime; Stripe.js
  // and Google OAuth load from their own hosts.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // XHR/WebSocket egress: Supabase, Stripe, LiveKit, Agora, PubNub + generic wss.
  "connect-src 'self' https: wss: https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.livekit.cloud wss://*.livekit.cloud https://*.agora.io wss://*.agora.io https://*.pubnub.com wss://*.pubnub.com",
  "media-src 'self' blob: https:",
  // Stripe Checkout + Google OAuth render in iframes; nothing else may embed us.
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Violation reporting. `report-uri` is the widely-supported legacy directive;
  // `report-to` is the modern Reporting API name (paired with the
  // Reporting-Endpoints header below). Both point at our collector route, which
  // stores reports in public.csp_reports for review before we enforce.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

// Baseline security headers applied to every route. The CSP above is attached
// as Report-Only (non-blocking) so it can be validated in production traffic
// before enforcement. Everything else here is already safe to enforce.
const SECURITY_HEADERS = [
  // Non-enforcing CSP: report violations, block nothing. Flip to the enforcing
  // header name once the reports are clean.
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
  // Names the modern Reporting API endpoint referenced by `report-to` above.
  // Browsers that support the Reporting API POST batched violation reports
  // (application/reports+json) to this URL; older browsers use `report-uri`.
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
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
