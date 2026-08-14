import Image from "next/image";
import type { Space } from "@/types/social";

// Horizontal audience-style avatar strip beneath the live-tiles row on the
// Cinema landing. Mirrors the audience row inside a Cinema room, so the
// landing's shape reads as "you're already looking at a Cinema" — a big main
// screen up top, three portrait tiles below, an audience at the bottom.
//
// Data source is deliberately opportunistic: we take up to `MAX` distinct
// hosts across the currently-live rooms. It isn't a real presence roster (no
// per-viewer heartbeats here), just a way to fill the row with faces that
// meaningfully belong to Cinema right now. When nothing is live we render
// dashed placeholder circles that match the PDF wireframe exactly.
const MAX = 8;

interface HostFace {
  id: string;
  name: string;
  avatarUrl: string | null;
}

function hostsFromLive(live: Space[]): HostFace[] {
  const seen = new Set<string>();
  const out: HostFace[] = [];
  for (const room of live) {
    const host = room.host;
    if (!host?.id || seen.has(host.id)) continue;
    seen.add(host.id);
    out.push({
      id: host.id,
      name: host.display_name || host.username || "Host",
      avatarUrl: host.avatar_url ?? null,
    });
    if (out.length >= MAX) break;
  }
  return out;
}

export function CinemaLandingAudience({ live }: { live: Space[] }) {
  const faces = hostsFromLive(live);
  // Always render MAX slots so the strip's silhouette is stable whether one
  // room is live or eight are. Empty slots are dashed circles, matching the
  // wireframe placeholder.
  const slots = Array.from({ length: MAX }, (_, i) => faces[i] ?? null);

  return (
    <div
      className="flex items-center gap-3 overflow-x-auto pb-1"
      style={{ overscrollBehaviorX: "contain", touchAction: "pan-x" }}
      aria-label="Cinema audience"
    >
      {slots.map((face, i) =>
        face ? (
          <span
            key={face.id}
            className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full border border-cinema-border bg-cinema-surface"
            title={face.name}
          >
            {face.avatarUrl ? (
              <Image
                src={face.avatarUrl}
                alt=""
                fill
                sizes="40px"
                className="object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-[10px] font-bold text-cinema-gold">
                {face.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
        ) : (
          <span
            key={`empty-${i}`}
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-full border border-dashed border-cinema-border"
          />
        ),
      )}
    </div>
  );
}
