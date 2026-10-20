"use client";

// SpacesStage — who is talking in an MM Spaces room.
//
// The host first, then up to SPACES_SPEAKER_LIMIT speakers, as circles that
// wrap three to a row. Each circle has a teal ring that grows and brightens with
// the person's live loudness (LiveKit audioLevel, sampled in livekitClient),
// a red mic badge when muted, and the host / moderator label under the name.
// Tapping anyone opens their person sheet (follow, react, and for the host or a
// moderator, the stage controls). A moderator also gets an "open seat" circle
// that opens the raised-hands queue while the stage has room.
//
// Spaces' own component; Cinema's seats are a separate file (Karl, 2 Oct 2026).

import { MicOff, Plus } from "lucide-react";
import type { SpaceParticipant } from "@/types/social";
import { spacesRing } from "@/lib/spacesRoom";
import { spacesAvatarColor, spacesInitials } from "@/lib/spacesAvatar";
import { isModeratorBadge } from "@/lib/roomBadge";

interface SpacesStageProps {
  speakers: readonly SpaceParticipant[];
  hostId: string;
  levels?: Record<string, number>;
  reactionBursts?: Record<string, string[]>;
  onSelect: (participant: SpaceParticipant) => void;
  /** Shown to the host / moderators while the stage has room. */
  onOpenSeat?: () => void;
  raisedHandCount?: number;
}

function StageCircle({
  participant,
  isHost,
  level,
  bursts,
  onSelect,
}: {
  participant: SpaceParticipant;
  isHost: boolean;
  level: number;
  bursts: string[];
  onSelect: (participant: SpaceParticipant) => void;
}) {
  const user = participant.user;
  const name = user?.display_name || user?.username || (isHost ? "Host" : "Speaker");
  const muted = Boolean(participant.is_muted || participant.host_muted);
  const ring = spacesRing({ level, speaking: Boolean(participant.is_speaking), muted });
  const role = isHost ? "Host" : isModeratorBadge(participant.badge) ? "Moderator" : "Speaker";

  return (
    <button
      type="button"
      onClick={() => onSelect(participant)}
      data-testid="spaces-stage-seat"
      data-seat-role={isHost ? "host" : "speaker"}
      data-speaking={ring.active ? "true" : "false"}
      aria-label={`${name}, ${role}${muted ? ", muted" : ring.active ? ", speaking" : ""}`}
      className="flex min-w-0 flex-col items-center gap-3 rounded-xl py-1 transition hover:bg-white/[0.03]"
    >
      <span className="relative block h-20 w-20 shrink-0 sm:h-24 sm:w-24">
        {/* Three concentric speaking rings that fill outward with loudness
            (spacesRingBands in src/lib/spacesRoom.ts). */}
        <span
          aria-hidden
          data-testid="spaces-speaking-ring"
          data-ring-active={ring.active ? "true" : "false"}
          className="pointer-events-none absolute rounded-full border-solid border-melori-teal transition-opacity duration-150 ease-out"
          style={{ inset: -3, borderWidth: 3, opacity: ring.bands[0] }}
        />
        <span
          aria-hidden
          data-ring-band="2"
          className="pointer-events-none absolute rounded-full border-solid border-melori-teal transition-opacity duration-150 ease-out"
          style={{ inset: -8, borderWidth: 2, opacity: ring.bands[1] }}
        />
        <span
          aria-hidden
          data-ring-band="3"
          className="pointer-events-none absolute rounded-full border-solid border-melori-teal transition-opacity duration-150 ease-out"
          style={{ inset: -12, borderWidth: 1.5, opacity: ring.bands[2] }}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full border-2 ${
            isHost ? "border-melori-purple" : "border-transparent"
          }`}
        />
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          <span
            className="grid h-full w-full place-items-center rounded-full text-2xl font-bold text-white"
            style={{ backgroundColor: spacesAvatarColor(participant.user_id) }}
          >
            {spacesInitials(name)}
          </span>
        )}
        {muted && (
          <span
            data-testid="spaces-muted-badge"
            className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-melori-void bg-melori-elevated"
          >
            <MicOff className="h-3.5 w-3.5 text-melori-danger" aria-hidden />
          </span>
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
        <span className="max-w-full truncate text-sm font-semibold text-melori-text">{name}</span>
        <span
          className={`text-[10px] ${
            isHost ? "text-melori-accent" : role === "Moderator" ? "text-melori-teal" : "text-melori-muted"
          }`}
        >
          {role}
        </span>
      </span>
    </button>
  );
}

export function SpacesStage({
  speakers,
  hostId,
  levels,
  reactionBursts,
  onSelect,
  onOpenSeat,
  raisedHandCount = 0,
}: SpacesStageProps) {
  return (
    <section aria-label="Stage" data-testid="spaces-stage" className="shrink-0">
      <div className="grid grid-cols-3 gap-x-3 gap-y-4 pt-2">
        {speakers.map((participant) => {
          const id = participant.user?.id ?? participant.user_id;
          return (
            <StageCircle
              key={participant.id}
              participant={participant}
              isHost={participant.user_id === hostId}
              level={levels?.[participant.user_id] ?? 0}
              bursts={reactionBursts?.[id] ?? []}
              onSelect={onSelect}
            />
          );
        })}
        {onOpenSeat && (
          <button
            type="button"
            onClick={onOpenSeat}
            data-testid="spaces-open-seat"
            aria-label={`Open seat. ${raisedHandCount} raised ${raisedHandCount === 1 ? "hand" : "hands"}`}
            className="flex min-w-0 flex-col items-center gap-2.5 rounded-xl py-1"
          >
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-white/15 text-melori-muted sm:h-24 sm:w-24">
              <Plus className="h-6 w-6" aria-hidden />
              {raisedHandCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-melori-pink px-1 text-[11px] font-bold text-white">
                  {raisedHandCount}
                </span>
              )}
            </span>
            <span className="text-xs text-melori-muted">Invite up</span>
          </button>
        )}
      </div>
    </section>
  );
}

export default SpacesStage;
