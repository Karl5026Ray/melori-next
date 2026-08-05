import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, Search, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Space } from "@/types/social";
import {
  CINEMA_ROOM_FORMAT,
  resolveGenreParam,
  pickFeatured,
} from "@/lib/cinema";
import { GenreTabs } from "@/components/social/cinema/GenreTabs";
import { FeaturedRoom } from "@/components/social/cinema/FeaturedRoom";
import { LiveRoomTile } from "@/components/social/cinema/LiveRoomTile";
import { StartingSoonList } from "@/components/social/cinema/StartingSoonList";

// Queries Supabase per request; never statically prerendered, and never served
// from the Data Cache — a room that just went live must show up on refresh.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "MM Cinema",
  description:
    "Watch together. Live listening rooms and synced watch parties on Melori — sit down with the artist and the room.",
};

const SELECT = `
  id, title, status, room_format, genre, scheduled_at, created_at,
  participant_count, host_id,
  host:profiles(id, username, display_name, avatar_url, role, verified)
`;

/**
 * Cinema rooms are `spaces` rows with room_format = 'cinema' — same engine as
 * Release Party and DJ Set, so they inherit roles, the raise-hand queue,
 * moderation, bans, and end-room teardown with no new code.
 *
 * Both the live and scheduled queries run in parallel; a slow scheduled query
 * shouldn't hold up the featured card, which is the whole point of the screen.
 */
async function getCinemaRooms(genre: string | null) {
  const base = () => {
    let q = supabase
      .from("spaces")
      .select(SELECT)
      .eq("room_format", CINEMA_ROOM_FORMAT);
    // "live now" is the default tab and means "no genre filter", so it maps to
    // a null slug and skips this narrowing entirely.
    if (genre) q = q.eq("genre", genre);
    return q;
  };

  const [liveRes, soonRes] = await Promise.all([
    base()
      .eq("status", "live")
      .order("participant_count", { ascending: false })
      .limit(5), // 1 featured + a 2x2 grid.
    base()
      .eq("status", "scheduled")
      // Soonest first — a STARTING SOON list ordered any other way is noise.
      .order("scheduled_at", { ascending: true })
      .limit(6),
  ]);

  if (liveRes.error) console.error("Cinema live query failed:", liveRes.error);
  if (soonRes.error) console.error("Cinema soon query failed:", soonRes.error);

  return {
    live: ((liveRes.data as unknown as Space[]) ?? []),
    soon: ((soonRes.data as unknown as Space[]) ?? []),
  };
}

interface PageProps {
  searchParams?: Promise<{ genre?: string }>;
}

export default async function CinemaDiscoverPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const genre = resolveGenreParam(searchParams?.genre);

  const { live, soon } = await getCinemaRooms(genre);
  const { featured, rest } = pickFeatured(live);
  const empty = live.length === 0 && soon.length === 0;

  return (
    // Cinema owns its own near-black surface rather than inheriting the purple
    // MM Social chrome — the mockups treat it as a theatre. pb-28 clears the
    // global MobileTabBar; this screen does NOT render its own bottom bar even
    // though the mockup shows one, because MM Social already has one app-wide.
    <div className="min-h-full flex-1 overflow-y-auto bg-cinema-void pb-28 md:pb-10">
      <div className="mx-auto max-w-2xl px-4 pt-5">
        {/* Header: wordmark left, search + start-a-room right. */}
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-cinema-gold" aria-hidden />
            <span className="text-lg font-bold uppercase tracking-[0.2em] text-white">
              Cinema
            </span>
          </h1>
          <div className="flex items-center gap-2">
            <Link
              href="/social/search"
              aria-label="Search Cinema"
              className="grid h-9 w-9 place-items-center rounded-full border border-cinema-border text-white/60 transition hover:border-cinema-gold/40 hover:text-cinema-gold"
            >
              <Search className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/social/spaces/create?format=cinema"
              aria-label="Start a Cinema room"
              className="grid h-9 w-9 place-items-center rounded-full bg-cinema-gold text-black transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </header>

        <div className="mb-6 border-b border-cinema-border">
          <GenreTabs active={genre} />
        </div>

        {empty ? (
          <div className="rounded-2xl border border-dashed border-cinema-border px-6 py-14 text-center">
            <Clapperboard
              className="mx-auto mb-3 h-8 w-8 text-cinema-gold-dim"
              aria-hidden
            />
            <p className="text-sm font-medium text-white">
              {genre ? "Nothing on in this genre yet" : "The house is empty"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-white/45">
              {genre
                ? "Try another genre, or start the first room here."
                : "No rooms are live right now. Be the one who opens the doors."}
            </p>
            <Link
              href="/social/spaces/create?format=cinema"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-cinema-gold px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Start a room
            </Link>
          </div>
        ) : (
          <>
            {featured && (
              <section className="mb-7">
                <FeaturedRoom room={featured} />
              </section>
            )}

            {rest.length > 0 && (
              <section className="mb-7">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/40">
                  Live now
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {rest.map((room) => (
                    <LiveRoomTile key={room.id} room={room} />
                  ))}
                </div>
              </section>
            )}

            {soon.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/40">
                  Starting soon
                </h2>
                <StartingSoonList rooms={soon} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
