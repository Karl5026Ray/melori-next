import Link from "next/link";
import MusicDownload from "./MusicDownload";

export const dynamic = "force-dynamic";

// Stripe returns the buyer here after a successful music purchase with
// ?session_id=... — MusicDownload polls /api/music/download for signed links.
export default async function MusicPurchaseSuccessPage(props: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await props.searchParams;

  return (
    <div className="min-h-screen bg-brand-bg text-text-primary">
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        {session_id ? (
          <MusicDownload sessionId={session_id} />
        ) : (
          <>
            <h1 className="text-xl font-bold">Purchase</h1>
            <p className="mt-2 text-sm text-text-secondary">
              We couldn&apos;t find your checkout session.
            </p>
            <Link
              href="/music"
              className="mt-6 inline-block rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Back to music
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
