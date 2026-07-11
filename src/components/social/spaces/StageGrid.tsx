import { SpaceParticipant } from "@/types/social";
import { BadgeCheck } from "lucide-react";

interface StageGridProps {
  participants: SpaceParticipant[];
  size?: "sm" | "md" | "lg";
  // Tapping an avatar invokes this so the parent can open a per-person
  // reaction picker aimed at that participant.
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  // Active floating reaction bursts keyed by the target participant's user id.
  // Each value is a list of unique burst keys of the form "<ts>-<seq>:<emoji>".
  reactionBursts?: Record<string, string[]>;
}

const sizeMap = {
  sm: {
    avatar: "w-10 h-10",
    name: "text-xs",
    grid: "grid-cols-5 sm:grid-cols-6 md:grid-cols-8",
  },
  md: {
    avatar: "w-16 h-16 md:w-20 md:h-20",
    name: "text-sm",
    grid: "grid-cols-3 sm:grid-cols-4",
  },
  lg: {
    avatar: "w-20 h-20 md:w-24 md:h-24",
    name: "text-base",
    grid: "grid-cols-2 sm:grid-cols-3",
  },
};

export function StageGrid({
  participants,
  size = "md",
  onReactToParticipant,
  reactionBursts,
}: StageGridProps) {
  const config = sizeMap[size];

  return (
    <div className={`grid ${config.grid} gap-6 md:gap-8`}>
      {participants.map((participant) => {
        const user = participant.user;
        const isSpeaking = participant.is_speaking && !participant.is_muted;
        const isHost = participant.role === "host";
        const targetId = user?.id ?? participant.user_id;
        const bursts = reactionBursts?.[targetId] ?? [];

        return (
          <div
            key={participant.id}
            className="relative flex flex-col items-center gap-2"
          >
            {/* Targeted reaction bursts float up over this person's avatar. */}
            {bursts.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 -top-3 z-20 flex justify-center gap-1">
                {bursts.map((r) => {
                  const emoji = r.slice(r.indexOf(":") + 1) || "❤️";
                  return (
                    <span
                      key={r}
                      className="text-2xl animate-bounce"
                      style={{ animationDuration: "1.6s" }}
                    >
                      {emoji}
                    </span>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => onReactToParticipant?.(participant)}
              aria-label={`React to ${user?.display_name ?? "participant"}`}
              className={`stage-avatar cursor-pointer ${
                isSpeaking ? "speaking-ring" : ""
              } rounded-full p-0.5 ${
                isHost
                  ? "border-2 border-melori-purple"
                  : "border-2 border-transparent"
              }`}
            >
              <img
                src={user?.avatar_url || "/favicon.png"}
                className={`${config.avatar} rounded-full object-cover`}
                alt={user?.display_name}
              />
              {isHost && <span className="host-badge">HOST</span>}
              {size !== "sm" && (
                <div
                  className={`mic-indicator ${
                    participant.is_muted ? "mic-off" : "mic-on"
                  }`}
                />
              )}
            </button>
            <span
              className={`${config.name} ${
                isHost ? "font-medium text-melori-text" : "text-melori-muted"
              } truncate w-20 text-center`}
            >
              {user?.display_name}
            </span>
            {user?.verified && size !== "sm" && (
              <BadgeCheck className="w-3.5 h-3.5 text-melori-purple -mt-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}
