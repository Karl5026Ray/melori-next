import Link from "next/link";
import Image from "next/image";
import type { Space } from "@/types/social";
import { formatWatching, roomHref } from "@/lib/cinema";

// One tile in the 3-across "LIVE NOW" row beneath the featured main screen.
// Portrait 9:16 so the shape matches what a guest camera actually looks like
// inside a Cinema room — the landing page and the sitting-down experience
// share the same silhouette instead of switching visual grammar mid-flow.
export function LiveRoomTile({ room }: { room: Space }) {
  const host = room.host;
  const hostName = host?.display_name || host?.username || "Host";

  return (
    <Link
      href={roomHref(room)}
      className="group relative flex aspect-[9/16] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-cinema-border bg-gradient-to-b from-cinema-gold/12 via-cinema-surface to-black transition-colors hover:border-cinema-gold/50"
    >
      {host?.avatar_url ? (
        <Image
          src={host.avatar_url}
          alt=""
          fill
          sizes="(max-width: 640px) 33vw, 220px"
          // Blurred + dimmed: same treatment as the featured hero, so the
          // strip reads as a set of small "main screens" rather than as a
          // row of profile pictures.
          className="scale-110 object-cover opacity-45 blur-md"
        />
      ) : null}

      {/* Bottom scrim keeps the title readable over any artwork. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black via-black/55 to-transparent" />

      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-cinema-gold px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-black">
        <span className="h-1 w-1 animate-pulse rounded-full bg-black" aria-hidden />
        Live
      </span>

      <div className="absolute inset-x-2 bottom-2 min-w-0">
        <h3 className="line-clamp-2 text-[11px] font-semibold leading-snug text-white">
          {room.title || hostName}
        </h3>
        <p className="mt-0.5 truncate text-[10px] text-white/60">
          {formatWatching(room.participant_count)}
        </p>
      </div>
    </Link>
  );
}
