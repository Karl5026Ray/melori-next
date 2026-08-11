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

// Enforcing Content-Security-Policy. This was shipped as *Report-Only* first and
// validated against ~2,700 production violation reports over several days: the
// only legitimate non-allowlisted resource was the Cloudflare Web Analytics
// beacon (static.cloudflareinsights.com), now added to script-src below. All
// other reports were browser-injected noise or preview-only widgets. The header
// key is now "Content-Security-Policy" (enforcing) so violations are blocked.
//
// Sources reflect Melori's real providers:
//   supabase.co (auth/db/storage/realtime), stripe.com/js.stripe.com (checkout),
//   *.livekit.cloud + wss (audio/video),
//   *.pubnub.com (presence), google/gstatic (OAuth + fonts),
//   static.cloudflareinsights.com (Cloudflare Web Analytics beacon).
const CSP_ENFORCED = [
  "default-src 'self'",
  // Next.js requires 'unsafe-inline'/'unsafe-eval' for its runtime; Stripe.js
  // and Google OAuth load from their own hosts; Cloudflare Web Analytics beacon.
  //
  // youtube.com + s.ytimg.com are the IFrame Player API. Cinema rooms load
  // https://www.youtube.com/iframe_api, which then pulls www-widgetapi.js from
  // one of those two hosts depending on the rollout. frame-src already allowed
  // the resulting iframe, so the first ship of YouTube Cinema playback failed
  // silently: the script was blocked, onYouTubeIframeAPIReady never fired, and
  // the room showed a black rectangle with no console error (CSP violations
  // report to /api/csp-report, not the console API).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://accounts.google.com https://apis.google.com https://static.cloudflareinsights.com https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // XHR/WebSocket egress: Supabase, Stripe, LiveKit, PubNub + generic wss.
  // blob: is required by the shared audio player: it fetches the unlock clip and
  // streamed track data as blob URLs, and XHR/fetch to a blob: URL is governed by
  // connect-src (not media-src). Without it the homepage radio fails to start.
  "connect-src 'self' blob: https: wss: https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.livekit.cloud wss://*.livekit.cloud https://*.pubnub.com wss://*.pubnub.com",
  // data: covers the tiny inline silent clip the player uses to unlock autoplay
  // on iOS, which was being blocked on / and /music.
  "media-src 'self' data: blob: https:",
  // Stripe Checkout + Google OAuth render in iframes, and both /video and the
  // Melori Mirror feed embed YouTube players (artist-submitted links; we never
  // re-host the media). Nothing else may embed us.
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com",
  // Was 'none'. Loosened to 'self' so wrapper browsers on iOS (Comet, Chrome iOS,
  // Perplexity, in-app WebViews) that render the top-level page inside their own
  // frame chrome don't get a hard "This page couldn't load" bounce. Safari native
  // was unaffected; Comet + Chrome iOS on 5G reproduce the block. Still keeps
  // third-party framing blocked by X-Frame-Options: SAMEORIGIN below.
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  // Violation reporting. `report-uri` is the widely-supported legacy directive;
  // `report-to` is the modern Reporting API name (paired with the
  // Reporting-Endpoints header below). Both point at our collector route, which
  // stores reports in public.csp_reports for review before we enforce.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

// Baseline security headers applied to every route. The CSP above is now
// enforced (blocking) after Report-Only validation in production traffic.
const SECURITY_HEADERS = [
  // Enforcing CSP: violations are now blocked. Validated in Report-Only mode
  // first; the reporting directives below stay so we keep visibility on any
  // future violations after enforcement.
  { key: "Content-Security-Policy", value: CSP_ENFORCED },
  // Names the modern Reporting API endpoint referenced by `report-to` above.
  // Browsers that support the Reporting API POST batched violation reports
  // (application/reports+json) to this URL; older browsers use `report-uri`.
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
  // Force HTTPS for a year across the apex + subdomains once the browser has
  // seen this header. `preload` is intentionally omitted until we're sure we
  // want to submit to the HSTS preload list.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Don't let anyone else iframe the app — protects against clickjacking on the
  // sign-in / checkout / studio surfaces. Was DENY; relaxed to SAMEORIGIN so iOS
  // wrapper browsers (Comet, Chrome iOS) that render pages inside their own
  // frame context can display the site. Cross-origin framing is still blocked,
  // and frame-ancestors 'self' in the CSP above provides the modern equivalent.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Don't sniff response bodies to guess the MIME type. Belt-and-suspenders
  // against "user uploads a .jpg that's actually HTML with a script tag".
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only send the origin (not the full path/query) on cross-origin nav — keeps
  // conversation IDs and space IDs out of Referer on outbound links.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny access to sensitive browser features we don't use. Camera + microphone
  // are needed for LiveKit voice/video rooms, so we allow same-origin for those.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=(self), usb=(), interest-cohort=()",
  },
];

const nextConfig = {
  // Playwright starts local development coverage at 127.0.0.1. Allow that
  // same-origin dev client to reconnect to Turbopack without weakening any
  // production origin policy.
  allowedDevOrigins: ["127.0.0.1"],
  // Keeps the request-mocked Concert browser test independent from a stale
  // development bundle that may have been built without public Supabase vars.
  // Production keeps Next's normal `.next` output directory.
  distDir: process.env.NEXT_E2E_DIST_DIR || '.next',
  // The request-mocked Playwright server writes generated route types to its
  // own config, so running the focused browser suite never rewrites tsconfig.
  typescript: {
    tsconfigPath: process.env.NEXT_E2E_TSCONFIG || "tsconfig.json",
  },
  reactStrictMode: true,
  // Studio photo galleries accept raw phone-camera JPEGs (iPhone/Canon
  // Camera Connect commonly produce 3-12 MB per shot). The App Router
  // default request body is 4.5 MB which returned 413 on any richly-
  // detailed photo — the client just showed "Upload Failed" with no
  // detail. Raising to 25 MB comfortably covers modern phone shots.
  // NOTE: per-route `maxDuration` and Vercel function memory are set in
  // vercel.json; this only widens the incoming request body ceiling.
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
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
      {
        // HTML-document cache override for iOS wrapper-browser compatibility.
        //
        // Root `/` (and other pages) use `dynamic = 'force-dynamic'`, which
        // causes Next.js to auto-emit
        //   Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
        // on the HTML response. That combination reliably confuses iOS wrapper
        // browsers built on WKWebView (Comet, Chrome iOS, in-app WebViews on
        // 5G): the response arrives (HTTP 200, full HTML body) but the browser
        // discards it and shows "This page couldn't load". Safari native is
        // unaffected because it doesn't wrap WKWebView.
        //
        // Overriding to `no-cache, must-revalidate` keeps the important part
        // (the browser MUST revalidate every navigation — user always sees
        // fresh HTML) but drops `no-store`, which was the trigger. Auth state
        // still can't be cached because SSR pages re-read cookies on every
        // request; this header only controls whether the intermediate response
        // may sit briefly in the browser's memory pipeline.
        //
        // Scoped to top-level document navigations by excluding /_next/*,
        // /api/*, and anything with a file extension. Applies to preview and
        // production; adjust only if we start proxying private per-user HTML.
        source: "/((?!api/|_next/|.*\\.).*)",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, must-revalidate" },
        ],
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
      // ── Purchases: REMOVED. Music commerce migrated off the VPS to Vercel-
      // native routes (/api/music/checkout -> /music/success, fulfilled via the
      // Stripe webhook + music_purchases table, downloads signed by
      // /api/music/download). Nothing calls /api/purchase/* anymore, so we no
      // longer proxy it to the VPS (whose Stripe key was expired anyway).
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
