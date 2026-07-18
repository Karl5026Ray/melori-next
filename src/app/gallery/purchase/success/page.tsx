import type { Metadata } from "next";
import Link from "next/link";
import PurchaseDownload from "./PurchaseDownload";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Purchase complete | Melori Gallery",
};

export default async function GalleryPurchaseSuccessPage(props: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await props.searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-background px-4 text-text-primary">
      <div className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-8 text-center">
        {session_id ? (
          <PurchaseDownload sessionId={session_id} />
        ) : (
          <>
            <h1 className="text-xl font-bold">Missing session</h1>
            <p className="mt-2 text-sm text-text-secondary">
              We couldn&apos;t find your checkout session.
            </p>
            <Link
              href="/gallery"
              className="mt-6 inline-block rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
            >
              Back to galleries
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
