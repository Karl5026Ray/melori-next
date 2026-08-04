import Image from "next/image";
import { Clapperboard, Clock, Users, Lock, Ticket } from "lucide-react";
import type { CinemaScreening } from "@/lib/cinema";
import { formatRuntime, formatStartsAt } from "@/lib/cinema";

// One programmed screening. Poster-forward (2:3, the film convention) rather
// than the 16:9 thumbnail Mirror and the video feed use — the different shape
// is the fastest signal to a member that Cinema is a different kind of watch.
export function ScreeningCard({ screening }: { screening: CinemaScreening }) {
  const artist = screening.artist;
  const live = screening.status === "live";

  return (
    <article className="group w-40 shrink-0 sm:w-44">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-melori-border bg-melori-elevated">
        {screening.poster_url ? (
          <Image
            src={screening.poster_url}
            alt=""
            fill
            sizes="(max-width: 640px) 40vw, 176px"
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-melori-purple/25 to-melori-pink/15">
            <Clapperboard className="h-8 w-8 text-melori-accent" aria-hidden />
          </div>
        )}

        {live && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-melori-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
            Live
          </span>
        )}

        {screening.access_tier === "ticketed" && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <Ticket className="h-3 w-3" aria-hidden />
            Ticketed
          </span>
        )}
        {screening.access_tier === "superfan" && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <Lock className="h-3 w-3" aria-hidden />
            Superfan
          </span>
        )}

        {screening.is_watch_party && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <Users className="h-3 w-3" aria-hidden />
            Watch party
          </span>
        )}
      </div>

      <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-melori-text">
        {screening.title}
      </h3>
      {artist?.display_name && (
        <p className="line-clamp-1 text-xs text-melori-muted">
          {artist.display_name}
        </p>
      )}
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-melori-muted">
        <Clock className="h-3 w-3" aria-hidden />
        {screening.status === "scheduled"
          ? formatStartsAt(screening.starts_at)
          : formatRuntime(screening.runtime_seconds)}
      </p>
    </article>
  );
}
