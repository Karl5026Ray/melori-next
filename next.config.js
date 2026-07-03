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

const nextConfig = {
  reactStrictMode: true,
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
