import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TipThanksPage(props: {
  searchParams: Promise<{ artist?: string }>;
}) {
  const { artist } = await props.searchParams;
  return (
    <div className="max-w-md mx-auto px-6 py-20 text-center">
      <h1 className="text-2xl font-bold">Thank you for your tip!</h1>
      <p className="mt-3 text-text-secondary">
        Your support goes directly to the artist. It means the world.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {artist && (
          <Link
            href={`/artists/${artist}`}
            className="rounded-md border border-brand-border px-4 py-2 text-sm text-text-primary transition-colors hover:text-brand-primary"
          >
            Back to artist
          </Link>
        )}
        <Link
          href="/music"
          className="rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Explore music
        </Link>
      </div>
    </div>
  );
}
