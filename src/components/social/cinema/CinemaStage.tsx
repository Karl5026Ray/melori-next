"use client";

// CinemaStage — the row of seat cards directly under the shared screen.
//
// Cinema deliberately does NOT reuse StageGrid. StageGrid renders circular
// avatars sized for a talk room; the Cinema mockup calls for labelled
// rectangular seats (HOST / GUEST / GUEST) that read like theatre seating and
// stay legible at 390px. The data is identical — the same `speakers` array the
// rest of the room page already maintains — only the presentation differs.
//
// Seats are padded out to MIN_SEATS so the row keeps its shape in an empty
// room instead of collapsing to a single lonely card.

import { Mic, MicOff } from "lucide-react";
import { SpaceParticipant } from "@/types/social";

const MIN_SEATS = 3;

interface CinemaStageProps {
  speakers: SpaceParticipant[];
  // Tapping an occupied seat opens the parent's per-person reaction picker,
  // matching StageGrid's behaviour so reactions work the same in both formats.
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
}

export function CinemaStage({
  speakers,
  onReactToParticipant,
  reactionBursts,
}: CinemaStageProps) {
  const emptySeats = Math.max(0, MIN_SEATS - speakers.length);

  return (
    <div className="mb-6 grid grid-cols-3 gap-2.5">
      {speakers.map((participant) => {
        const user = participant.user;
        const isHost = participant.role === "host";
        const muted = participant.is_muted || participant.host_muted;
        const isSpeaking = participant.is_speaking && !muted;
        const targetId = user?.id ?? participant.user_id;
        const bursts = reactionBursts?.[targetId] ?? [];
        const name = user?.display_name || user?.username || "Guest";

        return (
          <button
            key={participant.id}
            type="button"
            onClick={() => onReactToParticipant?.(participant)}
            aria-label={`React to ${name}`}
            className={`relative flex h-[72px] flex-col items-center justify-center rounded-xl border px-2 transition ${
              isHost
                ? "border-cinema-gold/70 bg-cinema-gold/[0.06]"
                : "border-cinema-border bg-white/[0.02]"
            } ${isSpeaking ? "ring-1 ring-melori-success/60" : ""} ${
              onReactToParticipant ? "hover:border-cinema-gold/50" : ""
            }`}
          >
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

            <span
              className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                isHost ? "text-cinema-gold" : "text-white/55"
              }`}
            >
              {isHost ? "Host" : "Guest"}
            </span>
            <span className="mt-1 max-w-full truncate text-[11px] text-white/45">
              {name}
            </span>

            {muted ? (
              <MicOff
                className="absolute right-2 top-2 h-3 w-3 text-white/30"
                aria-hidden
              />
            ) : isSpeaking ? (
              <Mic
                className="absolute right-2 top-2 h-3 w-3 text-melori-success"
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}

      {Array.from({ length: emptySeats }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="flex h-[72px] items-center justify-center rounded-xl border border-dashed border-cinema-border/70"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/20">
            Guest
          </span>
        </div>
      ))}
    </div>
  );
}

export default CinemaStage;
