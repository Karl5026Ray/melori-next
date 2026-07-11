// Route-level not-found so notFound() in the release page emits a real HTTP 404
// (the global not-found under a force-dynamic segment was returning 200,
// which let crawlers index non-existent release slugs).
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Release not found — MELORI MUSIC",
  description: "This release could not be found.",
};

export default function ReleaseNotFound() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-24 flex flex-col items-center text-center">
      <p className="text-6xl font-bold tracking-tight text-brand-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold text-text-primary">
        We couldn&apos;t find that release
      </h1>
      <p className="mt-3 text-text-secondary">
        This release may not exist or is no longer published.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/music"
          className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
        >
          Browse music
        </Link>
        <Link
          href="/"
          className="rounded-full border border-brand-border px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-white/5"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
