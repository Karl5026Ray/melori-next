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

import { SpaceParticipant } from "@/types/social";

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
  return (
    <section className="shrink-0" data-testid="cinema-audience-panel" aria-label="Cinema audience">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
          Audience · {audience.length}
        </p>
        <p className="text-[10px] text-white/35">Swipe to see everyone</p>
      </div>
      {audience.length === 0 ? (
        <p className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-white/35">
          No one in the audience yet.
        </p>
      ) : (
        <div
          className="hide-scrollbar flex gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-1"
          data-testid="cinema-audience-strip"
          aria-label="Cinema audience strip"
        >
          {audience.map((participant) => {
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
                className="group flex w-14 shrink-0 flex-col items-center gap-1.5"
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
                      className="h-11 w-11 rounded-full border border-white/15 object-cover transition group-hover:border-cinema-gold/50"
                    />
                  ) : (
                    <div className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.03] transition group-hover:border-cinema-gold/50">
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
    </section>
  );
}

export default CinemaAudience;
