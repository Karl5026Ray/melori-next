import { Suspense } from "react";
import { unstable_rethrow } from "next/navigation";
import Link from "next/link";
import CatalogCard from "@/components/CatalogCard";
import SuccessBanner from "@/components/SuccessBanner";
import ShareButton from "@/components/ShareButton";
import HomeHero from "@/components/HomeHero";
import NameMeaning from "@/components/NameMeaning";
import type { Metadata } from "next";
import { getReleases, getFeaturedTrack } from "@/lib/data";
import { getCatalogItems } from "@/lib/catalog";
import { sortMeloriFavorites } from "@/lib/releaseSort";

// ISR instead of `dynamic = 'force-dynamic'` — see issue #280.
//
// WHY NOT force-dynamic: Next.js stamps every dynamically rendered response
// with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`,
// and on Vercel that function-set header is the LAST writer. Neither the
// `headers()` block in next.config.js nor the override in src/proxy.ts can
// remove it, because both are applied by the routing layer around the function
// rather than after it. (Self-hosted `next start` behaves differently: there the
// config header does win, which is why this bug was invisible locally.)
//
// `no-store` is the specific directive that makes iOS WKWebView wrapper
// browsers (Comet, Chrome iOS, in-app WebViews) discard an otherwise healthy
// 200 response and show "This page couldn't load".
//
// WHY ISR IS SAFE HERE: this page renders identically for every visitor. All of
// its data comes from `getSupabaseAdmin()` (a service-role client — no cookies,
// no per-user session), and the only request-specific piece is <SuccessBanner>,
// a client component reading useSearchParams inside its own <Suspense>
// boundary. Nothing user-specific is rendered on the server, so a shared cache
// entry cannot leak between accounts.
//
// THIS ALSO MEANS THE PAGE CANNOT BRANCH ON AUTH STATE. Rendering a different
// homepage for signed-out visitors would make the route dynamic again and bring
// the no-store header — and the iOS "page couldn't load" bug — straight back.
// The signed-out door belongs in src/proxy.ts, which runs before this page and
// leaves its caching alone.
//
// THIS EXPORT ALONE IS NOT ENOUGH — that was the mistake in PR #282. A
// route-level `revalidate` cannot outrank an individual `fetch` marked
// `cache: "no-store"`, and every Supabase read went through a client that set
// exactly that. The route stayed dynamic and the header never changed. The
// actual fix is in src/lib/supabase/admin.ts: the public catalog reads now use
// `getSupabaseCatalogReader()`, which asks for `next: { revalidate: 60 }`
// instead of `no-store`, so no dynamic signal is emitted and this export takes
// effect.
export const revalidate = 60;

const description =
  "Free music from independent artists, live rooms, and cinema nights. Join Melori — creators keep what they make.";

export const metadata: Metadata = {
  title: { absolute: "MELORI MUSIC — Independent Music Platform" },
  description,
  openGraph: {
    title: "MELORI MUSIC — Independent Music Platform",
    description,
    images: ["/images/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "MELORI MUSIC — Independent Music Platform",
    description,
    images: ["/images/og-image.png"],
  },
};

export default async function HomePage() {
  const [releases, featuredTrack] = await Promise.all([
    // `unstable_rethrow` is required, not decorative. Next.js aborts static
    // generation by throwing internal control-flow values, so a bare
    // `.catch(() => [])` swallows that signal and the route silently prerenders
    // an EMPTY page instead of failing the build. Always rethrow framework
    // errors first, then degrade real data errors to an empty list.
    getReleases().catch((err) => {
      unstable_rethrow(err);
      return [];
    }),
    getFeaturedTrack().catch((err) => {
      unstable_rethrow(err);
      return null;
    }),
  ]);
  // Favorites is drawn from the WHOLE catalog — an artist's self-uploaded
  // single is eligible for the homepage on the same terms as a curated
  // release. Albums lead, ranked by lifetime plays, then everything else
  // newest-first so fresh uploads still surface. See sortMeloriFavorites.
  const catalogItems = await getCatalogItems(releases);
  const meloriFavorites = sortMeloriFavorites(catalogItems).slice(0, 12);

  return (
    <div>
      <Suspense fallback={null}>
        <SuccessBanner />
      </Suspense>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-5xl mx-auto px-6 pt-14 pb-12 flex flex-col items-center text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">MELORI MUSIC</h1>
          <p className="mt-4 text-lg md:text-xl text-text-secondary">
            Listen freely. Go live.{" "}
            <span className="whitespace-nowrap">Create endlessly.</span>
          </p>
          <p className="mt-4 max-w-2xl text-base text-text-secondary">
            Melori is where independent creators share their work, go live, and earn — you keep what you make.
          </p>

          {/* Instant-listening centerpiece: autoplays a real catalog track (muted, then
             unmutes on first interaction) using the shared site player. */}
          {featuredTrack && <HomeHero track={featuredTrack} />}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <Link href="/music" className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90">Explore Music</Link>
            <Link href="/register" className="rounded-full border border-brand-primary px-7 py-3 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white">Create a Profile</Link>
            <ShareButton />
          </div>
        </div>
      </section>

      {/* Melori Favorites — top 12 only. */}
      {meloriFavorites.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 pt-4 pb-12">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-2xl font-bold">Melori Favorites</h2>
            <Link href="/music" className="text-sm font-semibold text-brand-primary hover:underline">View all</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {meloriFavorites.map((item) => (
              <CatalogCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* The meaning of the name — mel (melody) + lori (lullaby). */}
      <NameMeaning />

      {/* Why Melori — value props.
          These used to advertise 30-second previews, Superfan unlocks and
          buying a track to own it. None of that exists any more: music is free
          to every member, there are no tiers and nothing is for sale. */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-brand-border bg-white/5 p-6">
            <h3 className="text-lg font-semibold text-text-primary">All the music, free</h3>
            <p className="mt-2 text-sm text-text-secondary">Every song in the catalog plays in full for every member. No tiers, no previews, no paywall — just create an account and listen.</p>
          </div>
          <div className="rounded-2xl border border-brand-border bg-white/5 p-6">
            <h3 className="text-lg font-semibold text-text-primary">Go live together</h3>
            <p className="mt-2 text-sm text-text-secondary">Spaces, Cinema, Faces and Mirror — rooms where creators and listeners are in the same place at the same time.</p>
          </div>
          <div className="rounded-2xl border border-brand-border bg-white/5 p-6">
            <h3 className="text-lg font-semibold text-text-primary">Built for creators</h3>
            <p className="mt-2 text-sm text-text-secondary">Upload your music, build a profile, and reach an audience that is actually listening — you keep what you make.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
