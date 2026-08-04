import type { Metadata } from "next";
import { Clapperboard } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ScreeningCard } from "@/components/social/cinema/ScreeningCard";
import type { CinemaScreening } from "@/lib/cinema";

// Queries Supabase per request; never statically prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "MM Cinema",
  description:
    "Premieres, concert films, and synced watch parties on Melori — sit down and watch with the artist and the room.",
};

const SELECT = `
  id, title, synopsis, poster_url, runtime_seconds, status, starts_at,
  is_watch_party, access_tier,
  artist:profiles!cinema_screenings_artist_id_fkey(id, display_name, avatar_url)
`;

/**
 * v1 is read-only: admins seed `cinema_screenings` (migration 050) and this
 * shelf renders it. The query is deliberately fault-tolerant — if the
 * migration hasn't been applied to an environment yet, the table is missing,
 * the query errors, and the page falls back to the empty state instead of
 * 500ing the whole /social/cinema route.
 */
async function getScreenings(): Promise<CinemaScreening[]> {
  const { data, error } = await supabase
    .from("cinema_screenings")
    .select(SELECT)
    .neq("status", "draft")
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(60);

  if (error) {
    console.error("MM Cinema: screenings unavailable:", error.message);
    return [];
  }
  return (data ?? []) as unknown as CinemaScreening[];
}

function Shelf({
  title,
  blurb,
  screenings,
}: {
  title: string;
  blurb: string;
  screenings: CinemaScreening[];
}) {
  if (screenings.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-melori-text">{title}</h2>
      <p className="mb-3 text-xs text-melori-muted">{blurb}</p>
      {/* Horizontal poster rail. `-mx-4 px-4` lets the rail bleed to the
          screen edges on a 390px phone so the next poster peeks in and the
          row reads as scrollable without a visible scrollbar. */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {screenings.map((screening) => (
          <ScreeningCard key={screening.id} screening={screening} />
        ))}
      </div>
    </section>
  );
}

export default async function CinemaPage() {
  const screenings = await getScreenings();

  const liveNow = screenings.filter((s) => s.status === "live");
  const upcoming = screenings.filter((s) => s.status === "scheduled");
  const onDemand = screenings.filter((s) => s.status === "available");
  const past = screenings.filter((s) => s.status === "ended");
  const empty = screenings.length === 0;

  return (
    // pb-28 clears the fixed mobile tab bar (same clearance contract the other
    // /social routes use) so the last rail isn't painted under navigation.
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-melori-text">
          <Clapperboard className="h-6 w-6 text-melori-purple" aria-hidden />
          MM Cinema
        </h1>
        <p className="mt-1 text-sm text-melori-muted">
          Premieres, concert films, and watch parties — the long-form room.
        </p>
      </header>

      <Shelf
        title="Screening now"
        blurb="Playing on a shared clock. Join and you're in sync with everyone else."
        screenings={liveNow}
      />
      <Shelf
        title="Coming soon"
        blurb="Scheduled premieres. Set a reminder and show up with the room."
        screenings={upcoming}
      />
      <Shelf
        title="Watch any time"
        blurb="On-demand features from Melori artists."
        screenings={onDemand}
      />
      <Shelf
        title="Past screenings"
        blurb="Missed it live? The recording lives here."
        screenings={past}
      />

      {empty && (
        <div className="rounded-2xl border border-dashed border-melori-border bg-melori-surface px-6 py-14 text-center">
          <Clapperboard
            className="mx-auto h-10 w-10 text-melori-accent"
            aria-hidden
          />
          <h2 className="mt-4 text-lg font-semibold text-melori-text">
            The house lights are still up
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-melori-muted">
            No screenings are programmed yet. Premieres, concert films, and
            synced watch parties will show up here first.
          </p>
        </div>
      )}
    </div>
  );
}
