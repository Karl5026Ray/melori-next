"use client";

// CinemaStage — the three podcast seats under the shared screen.
//
// Cinema is audio-only (Karl, 1 Oct 2026). The host and up to two guests sit
// here as large voice circles with a live volume ring and a mute badge; there
// are no camera tiles any more. A seat is "who the host has put on stage",
// the same `role` Spaces uses — see src/lib/cinemaStage.ts for the ordering
// and the two-guest cap the server enforces.
//
// Tapping a seat is the entry point for everything about that person: the host
// gets the moderation sheet (mute, move to audience, remove), everyone else a
// reaction picker. Tapping an EMPTY seat as host opens the raised-hands queue.

import { MicOff, Plus } from "lucide-react";
import { SpaceParticipant } from "@/types/social";
import { voiceRing } from "@/lib/voiceCircles";
import { cinemaAvatarColor, cinemaInitials } from "@/lib/cinemaAvatar";

interface CinemaStageProps {
  /** [host, guest, guest] from buildCinemaAudioSeats; null = open seat. */
  seats: readonly (SpaceParticipant | null)[];
  /** Identity (auth user id) -> 0..1 microphone level, sampled from LiveKit. */
  levels?: Record<string, number>;
  viewerIsHost?: boolean;
  onSelectSeat?: (participant: SpaceParticipant | null, seatIndex: number) => void;
  reactionBursts?: Record<string, string[]>;
}

function AudioSeat({
  participant,
  seatIndex,
  level,
  viewerIsHost,
  onSelectSeat,
  bursts,
}: {
  participant: SpaceParticipant | null;
  seatIndex: number;
  level: number;
  viewerIsHost?: boolean;
  onSelectSeat?: CinemaStageProps["onSelectSeat"];
  bursts: string[];
}) {
  const isHostSeat = seatIndex === 0;
  const roleLabel = isHostSeat ? "Host" : "Guest";

  if (!participant) {
    const hint = isHostSeat ? "Host away" : viewerIsHost ? "Tap to invite" : "Open seat";
    return (
      <button
        type="button"
        onClick={() => onSelectSeat?.(null, seatIndex)}
        disabled={!onSelectSeat || isHostSeat}
        data-testid="cinema-audio-seat"
        data-seat={isHostSeat ? "host" : `guest-${seatIndex}`}
        data-seat-empty="true"
        aria-label={isHostSeat ? "Host seat, empty" : `Open guest seat. ${hint}`}
        className="flex min-w-0 flex-col items-center gap-1 rounded-xl py-0.5 disabled:cursor-default"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-dashed border-white/15 text-white/30 sm:h-16 sm:w-16">
          <Plus className="h-5 w-5" aria-hidden />
        </span>
        <span className="max-w-full truncate text-xs text-white/40">{hint}</span>
      </button>
    );
  }

  const user = participant.user;
  const muted = Boolean(participant.is_muted || participant.host_muted);
  const name = user?.display_name || user?.username || roleLabel;
  const ring = voiceRing({ level, speaking: Boolean(participant.is_speaking), muted });

  return (
    <button
      type="button"
      onClick={() => onSelectSeat?.(participant, seatIndex)}
      disabled={!onSelectSeat}
      data-testid="cinema-audio-seat"
      data-seat={isHostSeat ? "host" : `guest-${seatIndex}`}
      data-speaking={ring.active ? "true" : "false"}
      aria-label={`${name}, ${roleLabel}${muted ? ", muted" : ring.active ? ", speaking" : ""}`}
      className="flex min-w-0 flex-col items-center gap-1 rounded-xl py-0.5 transition hover:bg-white/[0.03]"
    >
      <span className="relative grid h-12 w-12 shrink-0 place-items-center sm:h-16 sm:w-16">
        <span
          aria-hidden
          data-testid="cinema-seat-ring"
          className="pointer-events-none absolute -inset-1 rounded-full border-2 border-melori-teal transition-[transform,opacity] duration-150 ease-out motion-reduce:transform-none"
          style={{ transform: `scale(${ring.scale})`, opacity: ring.opacity }}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full border-2 ${
            isHostSeat ? "border-melori-purple" : "border-transparent"
          }`}
        />
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt=""
            decoding="async"
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span
            className="grid h-full w-full place-items-center rounded-full text-base font-bold text-white"
            style={{ backgroundColor: cinemaAvatarColor(participant.user_id) }}
          >
            {cinemaInitials(name)}
          </span>
        )}
        {muted && (
          <MicOff
            data-testid="cinema-seat-muted"
            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-cinema-void p-0.5 text-red-400"
            aria-hidden
          />
        )}
        {bursts.length > 0 && (
          <span className="pointer-events-none absolute inset-x-0 -top-4 z-20 flex justify-center gap-1">
            {bursts.map((reaction) => (
              <span key={reaction} className="animate-slide-up text-base leading-none">
                {reaction.slice(reaction.indexOf(":") + 1) || "❤️"}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="flex max-w-full flex-col items-center leading-tight">
        <span className="max-w-full truncate text-xs font-semibold text-white/90">{name}</span>
        <span
          className={`text-[10px] uppercase tracking-[0.14em] ${
            isHostSeat ? "text-melori-accent" : "text-white/45"
          }`}
        >
          {roleLabel}
        </span>
      </span>
    </button>
  );
}

export function CinemaStage({
  seats,
  levels,
  viewerIsHost,
  onSelectSeat,
  reactionBursts,
}: CinemaStageProps) {
  // Always exactly three seats in a fixed order, even while the roster loads.
  const fixed = [0, 1, 2].map((index) => seats[index] ?? null);

  return (
    <div
      className="grid shrink-0 grid-cols-3 gap-2"
      data-testid="cinema-audio-stage"
      aria-label="Stage: host and two guests"
    >
      {fixed.map((participant, index) => {
        const id = participant?.user?.id ?? participant?.user_id ?? "";
        return (
          <AudioSeat
            key={`seat-${index}`}
            participant={participant}
            seatIndex={index}
            level={id ? levels?.[id] ?? 0 : 0}
            viewerIsHost={viewerIsHost}
            onSelectSeat={onSelectSeat}
            bursts={id ? reactionBursts?.[id] ?? [] : []}
          />
        );
      })}
    </div>
  );
}

export default CinemaStage;
