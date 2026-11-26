import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShowPlayer from "@/components/shows/ShowPlayer";
import { formatShowLength, getPublicShows, getShowBySlug } from "@/lib/shows";

// One link per show (Karl, 26 Nov 2026): /shows/melori-radio-show-2. Public
// and free — a shared link plays for someone with no account, and the page
// invites them in. `?hour=2` opens on that part.
export const revalidate = 60;

export async function generateStaticParams() {
  return (await getPublicShows()).map((s) => ({ slug: s.slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const show = await getShowBySlug(slug);
  if (!show) return { title: "Show not found" };
  const description = `${show.name} with ${show.host} on Melori Radio. Independent music, free to play — no account needed.`;
  const images = show.coverUrl ? [show.coverUrl] : ["/images/og-image.png"];
  return {
    title: `${show.name} — Melori Radio`,
    description,
    alternates: { canonical: `/shows/${show.slug}` },
    openGraph: { title: `${show.name} — Melori Radio`, description, images, type: "music.radio_station" },
    twitter: { card: "summary_large_image", title: `${show.name} — Melori Radio`, description, images },
  };
}

export default async function ShowPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hour?: string }>;
}) {
  const { slug } = await props.params;
  const { hour } = await props.searchParams;
  const show = await getShowBySlug(slug);
  if (!show) notFound();
  const start = Math.max(0, (Number.parseInt(hour ?? "1", 10) || 1) - 1);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-melori-teal">
          Melori Radio &middot; free to play
        </p>
        <div className="mx-auto mt-5 aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-white/5 shadow-2xl">
          {show.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={show.coverUrl} alt={show.name} className="h-full w-full object-cover" />
          )}
        </div>
        <h1 className="mt-6 text-center text-3xl font-bold">{show.name}</h1>
        <p className="mt-1 text-center text-sm text-[#999]">
          with {show.host}
          {show.totalSeconds ? ` · ${formatShowLength(show.totalSeconds)}` : ""}
        </p>

        <div className="mt-8">
          <ShowPlayer show={show} startPart={start} />
        </div>

        <div className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <h2 className="text-lg font-bold">Like what you hear?</h2>
          <p className="mt-1 text-sm text-[#aaa]">
            Every song in this show is on Melori — full length, free to every member.
            The radio runs all day with Karl Ray and Jade.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link
              href="/platform"
              className="rounded-full bg-[#c9a96e] px-5 py-2.5 text-sm font-bold text-[#0a0a0a]"
            >
              Make a free account
            </Link>
            <Link
              href="/shows"
              className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white"
            >
              All shows
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
