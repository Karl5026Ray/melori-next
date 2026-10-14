"use client";

// CinemaVoiceCircles — the listeners' rail beside the room chat.
//
// Cinema has three seats (host + two guests). Everyone else is a listener, and
// this is where they live. History: three balanced rows of circles (Sept 2026),
// then one compact strip with a "+N" chip when the chat took the space under
// the stage (1 Oct 2026). The Clubhouse-style layout (13 Oct 2026) moves them
// to a narrow rail on the right of the lower region: a vertical list of 44px
// circles with names, raised hands first, then people the host follows, then
// everyone else (see orderVoiceRail). The rail scrolls inside its own column,
// so a packed room can never push the shared screen, the seats or the dock
// out of the viewport, and nobody is hidden behind a "+N" any more.
//
// Every circle wears a volume ring driven by LiveKit's per-participant
// `audioLevel` (sampled in livekitVideoClient, passed as `levels`). The ring
// falls back to the ActiveSpeakersChanged flag when a level has not arrived, so
// a speaker is never silently un-ringed. The math lives in @/lib/voiceCircles.

import { useMemo } from "react";
import { Hand, MicOff } from "lucide-react";
import { SpaceParticipant } from "@/types/social";
import { orderVoiceRail, voiceRing } from "@/lib/voiceCircles";
import { cinemaAvatarColor, cinemaInitials } from "@/lib/cinemaAvatar";

interface CinemaVoiceCirclesProps {
  audience: SpaceParticipant[];
  /** Identity (auth user id) -> 0..1 microphone level, sampled from LiveKit. */
  levels?: Record<string, number>;
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
  /** user ids the host follows; empty while loading or if the lookup failed. */
  followedByHost?: ReadonlySet<string>;
}

const NO_FOLLOWS: ReadonlySet<string> = new Set();

function VoiceCircle({
  participant,
  level,
  onReactToParticipant,
  bursts,
}: {
  participant: SpaceParticipant;
  level: number;
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  bursts: string[];
}) {
  const user = participant.user;
  const muted = Boolean(participant.is_muted || participant.host_muted);
  const name = user?.username || user?.display_name || "guest";
  const ring = voiceRing({
    level,
    speaking: Boolean(participant.is_speaking),
    muted,
  });

  const body = (
    <>
      {/* The ring is absolute inside a `relative block` box, never a centered
          grid container: a grid re-centres the scaled ring off the avatar. */}
      <span className="relative block h-11 w-11 shrink-0">
        {/* Volume ring. Scale and opacity follow the live level, so this is one
            element that breathes rather than a canned keyframe loop; a quiet
            circle is perfectly still. */}
        <span
          aria-hidden
          data-testid="cinema-voice-ring"
          data-ring-active={ring.active ? "true" : "false"}
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-melori-teal transition-[transform,opacity] duration-150 ease-out motion-reduce:transform-none"
          style={{ transform: `scale(${ring.scale})`, opacity: ring.opacity }}
        />
        {/* Resting ring, always visible, so an idle listener still reads as a
            present person rather than a floating avatar. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border border-white/10"
        />

        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span
            className="grid h-full w-full place-items-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: cinemaAvatarColor(participant.user_id) }}
          >
            {cinemaInitials(name)}
          </span>
        )}

        {participant.has_raised_hand ? (
          <Hand
            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-cinema-void p-0.5 text-melori-warning"
            aria-label={`${name} raised a hand`}
          />
        ) : (
          muted && (
            <MicOff
              className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-cinema-void p-0.5 text-white/45"
              aria-label={`${name} is muted`}
            />
          )
        )}

        {bursts.length > 0 && (
          <span className="pointer-events-none absolute inset-x-0 -top-3 z-20 flex justify-center gap-1">
            {bursts.map((reaction) => (
              <span key={reaction} className="animate-slide-up text-base leading-none">
                {reaction.slice(reaction.indexOf(":") + 1) || "❤️"}
              </span>
            ))}
          </span>
        )}
      </span>

      <span
        className={`block w-full truncate text-[10px] leading-tight ${
          ring.active ? "text-white/85" : "text-white/50"
        }`}
      >
        {name}
      </span>
    </>
  );

  const className = "flex w-full min-w-0 shrink-0 flex-col items-center gap-1 text-center transition";

  if (!onReactToParticipant) {
    return (
      <li className={className} data-testid="cinema-voice-circle">
        {body}
      </li>
    );
  }
  return (
    <li className="w-full min-w-0 shrink-0">
      <button
        type="button"
        onClick={() => onReactToParticipant(participant)}
        aria-label={`React to ${name}`}
        className={`${className} hover:opacity-90`}
        data-testid="cinema-voice-circle"
      >
        {body}
      </button>
    </li>
  );
}

export function CinemaVoiceCircles({
  audience,
  levels,
  onReactToParticipant,
  reactionBursts,
  followedByHost = NO_FOLLOWS,
}: CinemaVoiceCirclesProps) {
  const ordered = useMemo(
    () => orderVoiceRail(audience, followedByHost),
    [audience, followedByHost],
  );

  return (
    <section
      className="flex min-h-0 w-[72px] shrink-0 flex-col"
      data-testid="cinema-voice-circles"
      aria-label="Cinema voice audience"
    >
      <p className="shrink-0 pb-1.5 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-white/45 tabular-nums">
        {audience.length} watching
      </p>
      {/* A plain list in its own scroll column. The thin WebKit/Blink thumb is
          styled to stay visible; iOS falls back to its native overflow
          scroll indicator. */}
      <ul
        data-testid="cinema-voice-rail"
        className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto overscroll-contain pb-1 pr-0.5 pt-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/25 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[3px]"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.25) transparent" }}
      >
        {ordered.map((participant) => {
          const identity = participant.user?.id ?? participant.user_id;
          return (
            <VoiceCircle
              key={participant.id}
              participant={participant}
              level={levels?.[participant.user_id] ?? 0}
              onReactToParticipant={onReactToParticipant}
              bursts={reactionBursts?.[identity] ?? []}
            />
          );
        })}
      </ul>
    </section>
  );
}

export default CinemaVoiceCircles;
