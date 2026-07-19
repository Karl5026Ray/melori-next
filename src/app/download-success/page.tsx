/**
 * /download-success — LEGACY Stripe success landing (retired VPS music flow).
 *
 * The old VPS-backed music purchase flow used:
 *   success_url: https://melorimusic.org/download-success.html?session_id=...
 * and this page then called /api/purchase/verify, /api/purchase/info/:token and
 * /api/download/:token on the VPS.
 *
 * That flow has been replaced by the Vercel-native music commerce flow
 * (/api/music/checkout → /music/success). No current checkout sends users here.
 * To avoid a broken page for any old Stripe receipt link or bookmark that still
 * points at /download-success, this page now fails gracefully: it shows a short
 * message and redirects to the main music page, where the user's purchased
 * downloads are available from their account.
 */
"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function DownloadSuccessInner() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.replace("/music"), 4000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Thanks for your purchase</h1>
        <p className="mt-4 text-text-secondary">
          Your download is ready in your account. We&apos;ve updated how
          purchases work — taking you to the music library now.
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          If your download doesn&apos;t appear, contact{" "}
          <a
            href="mailto:support@melorimusic.org"
            className="text-brand-primary hover:underline"
          >
            support@melorimusic.org
          </a>{" "}
          with your receipt.
        </p>
        <div className="mt-8">
          <Link
            href="/music"
            className="rounded-full bg-brand-primary px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
          >
            Go to Music
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function DownloadSuccessPage() {
  return (
    <Suspense fallback={null}>
      <DownloadSuccessInner />
    </Suspense>
  );
}
