// Route-level not-found so notFound() in the artist page emits a real HTTP 404
// (the global not-found under a force-dynamic segment was returning 200,
// which let crawlers index non-existent artist slugs).
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Artist not found — MELORI MUSIC",
  description: "This artist could not be found.",
};

export default function ArtistNotFound() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-24 flex flex-col items-center text-center">
      <p className="text-6xl font-bold tracking-tight text-brand-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold text-text-primary">
        We couldn&apos;t find that artist
      </h1>
      <p className="mt-3 text-text-secondary">
        This artist may not exist or is no longer published.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/artists"
          className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
        >
          Browse artists
        </Link>
        <Link
          href="/music"
          className="rounded-full border border-brand-border px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-white/5"
        >
          Browse music
        </Link>
      </div>
    </div>
  );
}
