"use client";

// Global error boundary.
// WAS BROKEN: the app had no error.tsx, so any unhandled runtime error in a
// route fell through to Next.js' default (unbranded) error screen with no way
// to recover other than a manual reload.
// FIX: a branded, on-design error boundary that logs the error and offers a
// "Try again" (reset) action plus a path back home. Does not alter any UX flow.

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
error,
reset,
}: {
error: Error & { digest?: string };
reset: () => void;
}) {
useEffect(() => {
// Surface the error for observability without exposing details to the user.
console.error(error);
}, [error]);

return (
<div className="max-w-2xl mx-auto px-6 py-24 flex flex-col items-center text-center">
<p className="text-6xl font-bold tracking-tight text-brand-primary">Oops</p>
<h1 className="mt-4 text-2xl font-bold text-text-primary">
Something went wrong
</h1>
<p className="mt-3 text-text-secondary">
An unexpected error occurred. You can try again, or head back home.
</p>
<div className="mt-8 flex flex-wrap items-center justify-center gap-4">
<button
type="button"
onClick={() => reset()}
className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
>
Try again
</button>
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
