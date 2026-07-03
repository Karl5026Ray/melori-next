import { SpaceParticipant } from "@/types/social";
import { BadgeCheck } from "lucide-react";

interface StageGridProps {
  participants: SpaceParticipant[];
  size?: "sm" | "md" | "lg";
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

export function StageGrid({ participants, size = "md" }: StageGridProps) {
  const config = sizeMap[size];

  return (
    <div className={`grid ${config.grid} gap-6 md:gap-8`}>
      {participants.map((participant) => {
        const user = participant.user;
        const isSpeaking = participant.is_speaking && !participant.is_muted;
        const isHost = participant.role === "host";

        return (
          <div
            key={participant.id}
            className="flex flex-col items-center gap-2"
          >
            <div
              className={`stage-avatar ${
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
            </div>
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
