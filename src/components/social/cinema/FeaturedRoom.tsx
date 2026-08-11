import Link from "next/link";
import Image from "next/image";
import { Play } from "lucide-react";
import type { Space } from "@/types/social";
import { formatWatching, roomHref } from "@/lib/cinema";

// The full-width hero card at the top of discover ("Welcome 2 Louisiana —
// jade_m hosting · 214 watching"). 16:9 because Cinema's stage is a shared
// video surface, not a poster.
export function FeaturedRoom({ room }: { room: Space }) {
  const host = room.host;
  const hostName = host?.display_name || host?.username || "a host";

  return (
    <Link
      href={roomHref(room)}
      className="group relative block overflow-hidden rounded-2xl border border-cinema-border bg-cinema-surface"
    >
      <div className="relative aspect-video w-full">
        {host?.avatar_url ? (
          <Image
            src={host.avatar_url}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 640px"
            // Blurred + dimmed: the host avatar is a small square being used as
            // a 16:9 backdrop, so it's treated as texture behind the title
            // rather than as a legible image.
            className="scale-110 object-cover opacity-40 blur-xl transition duration-500 group-hover:opacity-50"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-cinema-gold/20 via-cinema-surface to-black" />
        )}

        {/* Bottom scrim so the title stays readable over any artwork. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-cinema-gold px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-black">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-black" aria-hidden />
          Live
        </span>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">
              {room.title}
            </h2>
            <p className="truncate text-xs text-white/60">
              {hostName} hosting &middot; {formatWatching(room.participant_count)}
            </p>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cinema-gold text-black transition group-hover:scale-105">
            <Play className="h-5 w-5 fill-current" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}
