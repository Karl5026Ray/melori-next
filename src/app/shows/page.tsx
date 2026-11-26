import type { Metadata } from "next";
import Link from "next/link";
import ShowPlayer from "@/components/shows/ShowPlayer";
import { getPublicShows } from "@/lib/shows";

// Every Melori Radio show, free to play (Karl, 26 Nov 2026). Public.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Melori Radio Shows",
  description:
    "Hour-long Melori Radio shows with Karl Ray and Jade — independent artists, free to play, no account needed.",
  alternates: { canonical: "/shows" },
  openGraph: {
    title: "Melori Radio Shows",
    description: "Hour-long shows with Karl Ray and Jade. Free to play.",
    images: ["/radio/melori-radio-cover.jpg"],
  },
};

export default async function ShowsIndex() {
  const shows = await getPublicShows();
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-bold">Melori Radio Shows</h1>
        <p className="mt-2 text-sm text-[#aaa]">
          Karl Ray and Jade, independent artists, and stories you won&apos;t hear anywhere
          else. Free to play — no account needed.
        </p>
        <div className="mt-8 space-y-3">
          {shows.length ? (
            shows.map((s) => <ShowPlayer key={s.slug} show={s} compact />)
          ) : (
            <p className="text-sm text-[#888]">The first show is coming soon.</p>
          )}
        </div>
        <p className="mt-8 text-center text-sm text-[#aaa]">
          Want every song, full length?{" "}
          <Link href="/platform" className="font-semibold text-[#c9a96e] hover:underline">
            Make a free account.
          </Link>
        </p>
      </div>
    </main>
  );
}
