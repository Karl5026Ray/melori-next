"use client";

// CinemaVoiceCircles — the voice-only audience beneath the Cinema stage.
//
// Cinema has exactly three live-video seats (host + two guests). Everyone else
// is voice-only, and this is where they live: three balanced rows of circular
// avatars, each wrapped in a volume ring that grows and brightens with how loud
// that person actually is.
//
// It replaces a single horizontally scrolling strip, which showed roughly five
// people at a time and hid the rest of the room behind a swipe. Three rows show
// far more of the room at a glance, and the ring makes it obvious who is talking
// without anyone having to read names. A very large room is capped and the
// remainder collapses into one "+N" chip, because the screen, the seats, and
// this block all have to share a single non-scrolling viewport.
//
// Loudness comes from LiveKit's per-participant `audioLevel`, sampled in
// livekitVideoClient and passed down as `levels`. The ring falls back to the
// coarse ActiveSpeakersChanged flag when a level has not arrived yet, so a
// speaker is never silently un-ringed. All of the math lives in
// @/lib/voiceCircles so it can be tested without a room.

import { MicOff } from "lucide-react";
import { SpaceParticipant } from "@/types/social";
import {
  partitionVoiceAudience,
  splitVoiceRows,
  voiceRing,
  VOICE_ROW_COUNT,
} from "@/lib/voiceCircles";

interface CinemaVoiceCirclesProps {
  audience: SpaceParticipant[];
  /** Identity (auth user id) -> 0..1 microphone level, sampled from LiveKit. */
  levels?: Record<string, number>;
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
}

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
      <span className="relative grid h-9 w-9 shrink-0 place-items-center sm:h-11 sm:w-11">
        {/* Volume ring. Scale and opacity are driven by the live level, so this
            is one element that breathes rather than a canned keyframe loop —
            a quiet circle is perfectly still. */}
        <span
          aria-hidden
          data-testid="cinema-voice-ring"
          data-ring-active={ring.active ? "true" : "false"}
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-cinema-gold transition-[transform,opacity] duration-150 ease-out motion-reduce:transform-none"
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
          <span className="grid h-full w-full place-items-center rounded-full bg-white/[0.04] text-sm font-medium text-white/40">
            {name.charAt(0).toUpperCase()}
          </span>
        )}

        {muted && (
          <MicOff
            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-cinema-void p-0.5 text-white/45"
            aria-label={`${name} is muted`}
          />
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

      {/* Phones have to fit a big screen, three live seats, and three rows of
          listeners in one non-scrolling viewport, and three lines of tiny names
          is what pushes that budget over. The ring and the avatar carry the
          meaning there; the name returns at sm and stays available to screen
          readers either way. */}
      <span className="sr-only sm:not-sr-only sm:max-w-full sm:truncate sm:text-[10px]">
        <span className={ring.active ? "sm:text-white/80" : "sm:text-white/40"}>{name}</span>
      </span>
    </>
  );

  const className =
    "group flex min-w-0 flex-col items-center gap-1 text-center transition";

  if (!onReactToParticipant) {
    return (
      <div className={className} data-testid="cinema-voice-circle">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onReactToParticipant(participant)}
      aria-label={`React to ${name}`}
      className={`${className} hover:opacity-90`}
      data-testid="cinema-voice-circle"
    >
      {body}
    </button>
  );
}

export function CinemaVoiceCircles({
  audience,
  levels,
  onReactToParticipant,
  reactionBursts,
}: CinemaVoiceCirclesProps) {
  // A packed room is capped so the three rows cannot grow tall enough to push
  // the shared screen out of the viewport; the remainder becomes one chip.
  const { visible, hiddenCount } = partitionVoiceAudience(audience);
  const rows = splitVoiceRows(visible, VOICE_ROW_COUNT);

  return (
    <section
      className="shrink-0"
      data-testid="cinema-voice-circles"
      aria-label="Cinema voice audience"
    >
      <div className="flex items-center justify-between px-1 pb-1.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
          Listening · {audience.length}
        </p>
        <p className="text-[10px] text-white/30">Tap a circle to react</p>
      </div>

      {audience.length === 0 ? (
        <p className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-white/35">
          No one listening yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 sm:gap-2">
          {rows.map((row, rowIndex) => (
            <div
              key={`voice-row-${rowIndex}`}
              data-testid="cinema-voice-row"
              // Rows wrap rather than scroll: a very large room compresses into
              // more circles per line instead of hiding people off-screen.
              className="flex flex-wrap items-start justify-center gap-x-2.5 gap-y-1.5 sm:gap-x-3"
            >
              {row.map((participant) => {
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
              {hiddenCount > 0 && rowIndex === rows.length - 1 && (
                <span
                  data-testid="cinema-voice-overflow"
                  className="flex min-w-0 flex-col items-center gap-1 text-center"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-[10px] font-semibold text-white/55 sm:h-11 sm:w-11 sm:text-[11px]">
                    +{hiddenCount}
                  </span>
                  <span className="sr-only sm:not-sr-only sm:max-w-full sm:truncate sm:text-[10px] sm:text-white/40">
                    listening
                  </span>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default CinemaVoiceCircles;
