# MELORI Music Platform — Next.js Rebuild (melori-next)

Phase 1 music-platform rebuild per **BUILD SPECIFICATION v1.1**. Parallel build: this is a NEW project on a Vercel preview URL. The live site at melorimusic.org (powered by the separate `Karl5026Ray/melori` repo) is **not touched**.

## Stack
Next.js 14 (App Router, TS) · Supabase · Resend · Stripe · Cloudflare · Vercel · GitHub

## Brand
All colors, logo, and fonts are extracted from the live melorimusic.org site. See [`/docs/BRAND.md`](./docs/BRAND.md). Do not invent new branding.

- Primary `#ff5500` · Background `#111111` · Surface `#1e1e1e` · Text `#ffffff` / `#b2b2b2` · Font Inter

## Getting started
```bash
npm install
cp .env.local.example .env.local   # fill in values (never commit)
npm run dev
```

## Database
Supabase migrations live in `/supabase/migrations/`. Run `001_initial_schema.sql` then `002_seed_data.sql` in order.

## Environment variables
See `.env.local.example` and BUILD SPEC Section 6. Set real values in the Vercel dashboard only — never commit secrets.

## Build status (Phase 1)
- [x] Step 1: Project setup + brand extraction
- [ ] Step 2: Supabase Storage
- [ ] Step 3: API routes
- [ ] Step 4: Frontend pages
- [ ] Step 5: Persistent audio player
- [ ] Step 6: Data migration
- [ ] Step 7: SEO & meta
- [ ] Step 8: Testing
