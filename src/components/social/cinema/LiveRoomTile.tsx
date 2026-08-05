import Link from "next/link";
import type { Space } from "@/types/social";
import { formatWatching } from "@/lib/cinema";

// One tile in the 2x2 "LIVE NOW" grid. Compact by design — at two columns on a
// 390px phone each tile is ~170px wide, so it carries only a LIVE tag, the
// title, and the audience count.
export function LiveRoomTile({ room }: { room: Space }) {
  return (
    <Link
      href={`/social/spaces/${room.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface transition-colors hover:border-cinema-gold/40"
    >
      <div className="relative aspect-video w-full bg-gradient-to-br from-cinema-gold/12 via-cinema-surface to-black">
        <span className="absolute left-2 top-2 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cinema-gold backdrop-blur">
          Live
        </span>
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 text-xs font-medium leading-snug text-white">
          {room.title}
        </h3>
        <p className="mt-1 text-[11px] text-white/45">
          {formatWatching(room.participant_count)}
        </p>
      </div>
    </Link>
  );
}
