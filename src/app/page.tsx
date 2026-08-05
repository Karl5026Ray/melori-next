import { Suspense } from "react";
import Link from "next/link";
import CatalogCard from "@/components/CatalogCard";
import SuccessBanner from "@/components/SuccessBanner";
import ShareButton from "@/components/ShareButton";
import ProductCard from "@/app/store/ProductCard";
import HomeHero from "@/components/HomeHero";
import NameMeaning from "@/components/NameMeaning";
import type { Metadata } from "next";
import { getReleases, getStoreProducts, getFeaturedTrack } from "@/lib/data";
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
// 60s keeps new releases appearing promptly while letting the response carry a
// cacheable header instead of `no-store`.
export const revalidate = 60;

const description =
  "Preview any song free, go Superfan for full playback, or buy the track to own it. Independent music with no platform cut — artists keep every dollar after payment processing.";

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
  const [releases, storeProducts, featuredTrack] = await Promise.all([
    getReleases().catch(() => []),
    getStoreProducts(8).catch(() => []),
    getFeaturedTrack().catch(() => null),
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
Preview freely. Support directly.{" "}
<span className="whitespace-nowrap">Create endlessly.</span>
</p>
<p className="mt-4 max-w-2xl text-base text-text-secondary">
Preview any song free. Go Superfan for full playback, or buy the track to own it. No platform cut — artists keep every dollar after payment processing.
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

{/* Melori Store — merch strip. Surfaces the store on the desktop main page
   (it was previously reachable only through the mobile launcher / nav). */}
{storeProducts.length > 0 && (
<section className="max-w-6xl mx-auto px-6 pt-4 pb-12">
<div className="mb-6 flex items-end justify-between">
<h2 className="text-2xl font-bold">Melori Store</h2>
<Link href="/store" className="text-sm font-semibold text-brand-primary hover:underline">Shop all</Link>
</div>
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
{storeProducts.map((product) => (
<ProductCard key={product.id} product={product} />
))}
</div>
</section>
)}

{/* The meaning of the name — mel (melody) + lori (lullaby). */}
<NameMeaning />

{/* Why Melori — value props */}
<section className="max-w-6xl mx-auto px-6 pb-20">
<div className="grid gap-6 sm:grid-cols-3">
<div className="rounded-2xl border border-brand-border bg-white/5 p-6">
<h3 className="text-lg font-semibold text-text-primary">Preview freely</h3>
<p className="mt-2 text-sm text-text-secondary">Every song in the catalog opens with a free 30-second preview — no account, no gate. Superfan unlocks full playback.</p>
</div>
<div className="rounded-2xl border border-brand-border bg-white/5 p-6">
<h3 className="text-lg font-semibold text-text-primary">Support directly</h3>
<p className="mt-2 text-sm text-text-secondary">Buy a single or an album to own it and keep it. Your money goes to the artist, not to a platform cut.</p>
</div>
<div className="rounded-2xl border border-brand-border bg-white/5 p-6">
<h3 className="text-lg font-semibold text-text-primary">Create &amp; earn</h3>
<p className="mt-2 text-sm text-text-secondary">Upload your music and sell it with no platform cut — you keep every dollar after payment processing.</p>
</div>
</div>
</section>
</div>
);
}
