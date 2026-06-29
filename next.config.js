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
      // ── Members / auth (sign-in, sign-up, sessions, password reset, profile)
      {
        source: '/api/members/:path*',
        destination: `${VPS_ORIGIN}/api/members/:path*`,
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
