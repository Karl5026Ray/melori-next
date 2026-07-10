// Custom 404 page.
// WAS BROKEN: the app had no not-found.tsx, so Next.js served its bare default
// "404 | This page could not be found." screen with no branding or navigation.
// FIX: branded, on-design 404 with clear paths back into the site (home + music).

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
title: "Page not found — MELORI MUSIC",
description: "The page you were looking for could not be found.",
};

export default function NotFound() {
return (
<div className="max-w-2xl mx-auto px-6 py-24 flex flex-col items-center text-center">
<p className="text-6xl font-bold tracking-tight text-brand-primary">404</p>
<h1 className="mt-4 text-2xl font-bold text-text-primary">
We couldn&apos;t find that page
</h1>
<p className="mt-3 text-text-secondary">
The link may be broken or the page may have moved. Let&apos;s get you back to the music.
</p>
<div className="mt-8 flex flex-wrap items-center justify-center gap-4">
<Link
href="/"
className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
>
Back to home
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
