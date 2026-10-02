"use client";

// SpacesStage — who is talking in an MM Spaces room.
//
// The host first, then up to SPACES_SPEAKER_LIMIT speakers, as circles that
// wrap four to a row. Each circle has a teal ring that grows and brightens with
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
  const role = isHost ? "Host" : participant.badge === "mod" ? "Moderator" : "Speaker";

  return (
    <button
      type="button"
      onClick={() => onSelect(participant)}
      data-testid="spaces-stage-seat"
      data-seat-role={isHost ? "host" : "speaker"}
      data-speaking={ring.active ? "true" : "false"}
      aria-label={`${name}, ${role}${muted ? ", muted" : ring.active ? ", speaking" : ""}`}
      className="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1 transition hover:bg-white/[0.03]"
    >
      <span className="relative grid h-14 w-14 shrink-0 place-items-center sm:h-16 sm:w-16">
        <span
          aria-hidden
          data-testid="spaces-speaking-ring"
          className="pointer-events-none absolute -inset-1 rounded-full border-[3px] border-melori-teal transition-[transform,opacity] duration-150 ease-out motion-reduce:transform-none"
          style={{ transform: `scale(${ring.scale})`, opacity: ring.opacity }}
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
            className="grid h-full w-full place-items-center rounded-full text-lg font-bold text-white"
            style={{ backgroundColor: spacesAvatarColor(participant.user_id) }}
          >
            {spacesInitials(name)}
          </span>
        )}
        {muted && (
          <span
            data-testid="spaces-muted-badge"
            className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-melori-void bg-melori-elevated"
          >
            <MicOff className="h-3 w-3 text-melori-danger" aria-hidden />
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
        <span className="max-w-full truncate text-xs font-semibold text-melori-text">{name}</span>
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
      <div className="grid grid-cols-4 gap-x-2 gap-y-2">
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
            className="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1"
          >
            <span className="relative grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-white/15 text-melori-muted sm:h-16 sm:w-16">
              <Plus className="h-5 w-5" aria-hidden />
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
