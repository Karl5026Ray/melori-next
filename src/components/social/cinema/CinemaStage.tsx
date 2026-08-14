"use client";

import { useEffect, useRef } from "react";
import { Camera, Mic, MicOff } from "lucide-react";
import { SpaceParticipant } from "@/types/social";
import type { CinemaSlot } from "@/lib/roomMediaPolicy";

export interface CinemaCameraSlot {
  slot: CinemaSlot;
  participant: SpaceParticipant | null;
  videoElement: HTMLVideoElement | null;
}

interface CinemaStageProps {
  slots: readonly CinemaCameraSlot[];
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
  /** Renders the fixed seats inside the shared Cinema media frame. */
  embedded?: boolean;
}

function CameraSeat({
  seat,
  onReactToParticipant,
  reactionBursts,
}: {
  seat: CinemaCameraSlot;
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
}) {
  const videoHostRef = useRef<HTMLDivElement>(null);
  const participant = seat.participant;
  const user = participant?.user;
  const isHost = seat.slot === 0;
  const muted = Boolean(participant?.is_muted || participant?.host_muted);
  const isSpeaking = Boolean(participant?.is_speaking && !muted);
  const name = user?.display_name || user?.username || (isHost ? "Host" : "Guest");
  const targetId = user?.id ?? participant?.user_id ?? "";
  const bursts = reactionBursts?.[targetId] ?? [];

  // LiveKit hands us a real attached <video>, which React must not recreate.
  // The host container itself remains keyed by stable slot number, so a guest
  // departure leaves an empty tile instead of moving another camera.
  useEffect(() => {
    const host = videoHostRef.current;
    if (!host) return;
    if (!seat.videoElement) {
      host.replaceChildren();
      return;
    }
    seat.videoElement.className = "h-full w-full object-cover";
    seat.videoElement.setAttribute("data-testid", "cinema-camera-video");
    host.replaceChildren(seat.videoElement);
  }, [seat.videoElement]);

  const contents = (
    <>
      <div
        ref={videoHostRef}
        className={`absolute inset-0 overflow-hidden bg-white/[0.03] ${
          seat.videoElement ? "" : "hidden"
        }`}
      />
      {!seat.videoElement && (
        <div
          className="absolute inset-0 grid place-items-center bg-gradient-to-b from-white/[0.05] to-transparent"
          data-testid="cinema-camera-placeholder"
          aria-label={`${name} camera is off or offline`}
        >
          <Camera className="h-5 w-5 text-white/20" aria-hidden />
          <span className="sr-only">Camera off or offline</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-1.5 bg-gradient-to-t from-black/85 via-black/25 to-transparent px-2.5 pb-2 pt-8">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] ${
            isHost ? "bg-cinema-gold/90 text-black" : "bg-black/65 text-white/65"
          }`}
        >
          {isHost ? "Host" : "Guest"}
        </span>
        <span className="min-w-0 truncate text-[11px] text-white/80">{name}</span>
      </div>
      {participant && (muted ? (
        <MicOff className="absolute right-2 top-2 h-3.5 w-3.5 text-white/50" aria-label="Muted" />
      ) : isSpeaking ? (
        <Mic className="absolute right-2 top-2 h-3.5 w-3.5 text-melori-success" aria-label="Speaking" />
      ) : null)}
      {bursts.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 -top-2 z-20 flex justify-center gap-1">
          {bursts.map((reaction) => (
            <span key={reaction} className="animate-slide-up text-base leading-none">
              {reaction.slice(reaction.indexOf(":") + 1) || "❤️"}
            </span>
          ))}
        </div>
      )}
    </>
  );

  const className = `relative block aspect-video w-full min-w-0 overflow-hidden rounded-xl border ${
    isHost ? "border-cinema-gold/70" : "border-cinema-border"
  } ${isSpeaking ? "ring-1 ring-melori-success/60" : ""}`;

  if (!participant || !onReactToParticipant) {
    return <div className={className}>{contents}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onReactToParticipant(participant)}
      aria-label={`React to ${name}`}
      className={`${className} text-left transition hover:border-cinema-gold/50`}
    >
      {contents}
    </button>
  );
}

export function CinemaStage({
  slots,
  onReactToParticipant,
  reactionBursts,
  embedded = false,
}: CinemaStageProps) {
  // Caller maps reservations through buildCinemaSlotAssignments. This defensive
  // fill keeps the DOM shape exactly three tiles even while initial data loads.
  const stableSlots: CinemaCameraSlot[] = [0, 1, 2].map((slot) => (
    slots.find((seat) => seat.slot === slot) ?? {
      slot: slot as CinemaSlot,
      participant: null,
      videoElement: null,
    }
  ));

  return (
    <div
      className={
        embedded
          ? "absolute bottom-2 left-2 right-12 z-30 grid grid-cols-3 gap-1.5 sm:bottom-3 sm:left-3 sm:right-14 sm:gap-2"
          : "mb-2 grid grid-cols-3 gap-2.5 md:mb-4"
      }
      data-testid="cinema-camera-stage"
      aria-label="Cinema camera stage"
    >
      {stableSlots.map((seat) => (
        <div
          key={`camera-slot-${seat.slot}`}
          data-testid="cinema-camera-slot"
          data-camera-slot={seat.slot}
          data-camera-seat={seat.slot === 0 ? "host" : `guest-${seat.slot}`}
        >
          <CameraSeat
            seat={seat}
            onReactToParticipant={onReactToParticipant}
            reactionBursts={reactionBursts}
          />
        </div>
      ))}
    </div>
  );
}

export default CinemaStage;
