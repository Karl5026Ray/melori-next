"use client";

// CinemaAudience — the "WATCHING · N" block beneath the stage.
//
// Three columns of circular avatars with the username underneath, and a green
// presence dot on anyone currently unmuted and speaking. Mirrors the mockup,
// which reads as a room of faces rather than the dense small-avatar grid the
// talk-room format uses.
//
// The count in the header is the audience length passed in by the room page,
// which already excludes people who have left (left_at is set).

import { useState } from "react";
import { SpaceParticipant } from "@/types/social";

// Cinema is the format built to hold a big room, so the grid is capped and
// revealed on demand rather than rendering an avatar per viewer. At three
// columns this is ten rows -- already more scrolling than anyone wants between
// the screen and the comment bar.
const COLLAPSED_COUNT = 30;

interface CinemaAudienceProps {
  audience: SpaceParticipant[];
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
}

export function CinemaAudience({
  audience,
  onReactToParticipant,
  reactionBursts,
}: CinemaAudienceProps) {
  const [expanded, setExpanded] = useState(false);

  const hidden = Math.max(0, audience.length - COLLAPSED_COUNT);
  // The header count always reports the true total, so collapsing never
  // misrepresents how many people are in the room.
  const shown = expanded ? audience : audience.slice(0, COLLAPSED_COUNT);

  return (
    <div className="mb-6">
      <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
        Watching · {audience.length}
      </p>

      {audience.length === 0 ? (
        <p className="py-6 text-center text-xs text-white/25">
          No one in the audience yet.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-x-4 gap-y-5">
          {shown.map((participant) => {
            const user = participant.user;
            const muted = participant.is_muted || participant.host_muted;
            const isLive = participant.is_speaking && !muted;
            const targetId = user?.id ?? participant.user_id;
            const bursts = reactionBursts?.[targetId] ?? [];
            const name = user?.username || user?.display_name || "guest";

            return (
              <button
                key={participant.id}
                type="button"
                onClick={() => onReactToParticipant?.(participant)}
                aria-label={`React to ${name}`}
                className="group flex flex-col items-center gap-2"
              >
                <div className="relative">
                  {bursts.length > 0 && (
                    <div className="pointer-events-none absolute inset-x-0 -top-3 z-20 flex justify-center gap-1">
                      {bursts.map((r) => (
                        <span
                          key={r}
                          className="animate-slide-up text-base leading-none"
                        >
                          {r.slice(r.indexOf(":") + 1) || "❤️"}
                        </span>
                      ))}
                    </div>
                  )}

                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 rounded-full border border-white/15 object-cover transition group-hover:border-cinema-gold/50"
                    />
                  ) : (
                    <div className="grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/[0.03] transition group-hover:border-cinema-gold/50">
                      <span className="text-sm font-medium text-white/40">
                        {name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}

                  {isLive && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-cinema-void bg-melori-success"
                      aria-label="Speaking"
                    >
                      <span className="h-1 w-1 rounded-full bg-cinema-void" />
                    </span>
                  )}
                </div>

                <span
                  className={`max-w-full truncate text-[11px] ${
                    isLive ? "text-white/80" : "text-white/40"
                  }`}
                >
                  {name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 w-full rounded-xl border border-cinema-border py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/40 transition hover:border-cinema-gold/50 hover:text-cinema-gold"
        >
          {expanded ? "Show fewer" : `Show all ${audience.length}`}
        </button>
      )}
    </div>
  );
}

export default CinemaAudience;
