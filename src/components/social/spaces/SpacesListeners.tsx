"use client";

// SpacesListeners — the audience strip under the Spaces stage.
//
// Small colored circles with first names, capped at SPACES_LISTENERS_VISIBLE so
// a 300-person room never pushes the chat off a phone screen; the rest are one
// "+N" circle that opens the full listener list. A raised hand shows as an
// amber badge so the host can spot it without opening anything.
//
// Spaces' own component (Karl, 2 Oct 2026: no shared room code with Cinema).

import { Hand } from "lucide-react";
import type { SpaceParticipant } from "@/types/social";
import { spacesAvatarColor, spacesInitials } from "@/lib/spacesAvatar";

/** Two rows of circles on a 390px phone. */
export const SPACES_LISTENERS_VISIBLE = 11;

interface SpacesListenersProps {
  listeners: readonly SpaceParticipant[];
  onSelect: (participant: SpaceParticipant) => void;
  onShowAll: () => void;
}

export function SpacesListeners({ listeners, onSelect, onShowAll }: SpacesListenersProps) {
  const overflow = listeners.length > SPACES_LISTENERS_VISIBLE;
  const visible = overflow ? listeners.slice(0, SPACES_LISTENERS_VISIBLE - 1) : listeners;
  const hidden = listeners.length - visible.length;

  return (
    <section aria-label="Listeners" data-testid="spaces-listeners" className="shrink-0">
      <div className="flex items-center justify-between pb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-melori-muted">
          {listeners.length} listening
        </p>
        {listeners.length > 0 && (
          <button
            type="button"
            onClick={onShowAll}
            data-testid="spaces-listeners-all"
            className="text-xs font-semibold text-melori-accent hover:underline"
          >
            See all
          </button>
        )}
      </div>
      {listeners.length === 0 ? (
        <p className="text-xs text-melori-muted">No listeners yet. Share the room link.</p>
      ) : (
        <div className="grid grid-cols-6 gap-x-1.5 gap-y-2">
          {visible.map((participant) => {
            const name =
              participant.user?.display_name || participant.user?.username || "Listener";
            return (
              <button
                key={participant.id}
                type="button"
                onClick={() => onSelect(participant)}
                data-testid="spaces-listener"
                aria-label={`${name}${participant.has_raised_hand ? ", hand raised" : ""}`}
                className="flex min-w-0 flex-col items-center gap-0.5"
              >
                <span className="relative grid h-10 w-10 place-items-center">
                  {participant.user?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={participant.user.avatar_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="grid h-full w-full place-items-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: spacesAvatarColor(participant.user_id) }}
                    >
                      {spacesInitials(name)}
                    </span>
                  )}
                  {participant.has_raised_hand && (
                    <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-melori-void bg-melori-warning">
                      <Hand className="h-2.5 w-2.5 text-melori-void" aria-hidden />
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate text-[10px] text-melori-muted">
                  {name.split(" ")[0]}
                </span>
              </button>
            );
          })}
          {hidden > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              data-testid="spaces-listeners-overflow"
              aria-label={`${hidden} more listening. See all`}
              className="flex min-w-0 flex-col items-center gap-0.5"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-melori-elevated text-xs font-bold text-melori-text">
                +{hidden}
              </span>
              <span className="text-[10px] text-melori-muted">more</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default SpacesListeners;
