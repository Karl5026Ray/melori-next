"use client";

// MM Spaces participant grid.
//
// Redesigned to match the reference room mockup Karl supplied: squircle tiles
// (not circles) in a roomy 3-across grid, with the four corners of each tile
// carrying its own piece of state and the name line carrying the rest.
//
//   top-right     blue "+"      follow this member
//   bottom-right  grey mic-off  muted (self-muted OR host-muted)
//   bottom-left   badge disc    host / moderator / co-host / VIP
//   ring          light outline currently speaking
//   name line     green ✳      verified, inline with the name (used to be a
//                               BadgeCheck on its own line, which knocked the
//                               rows out of vertical alignment)
//   name line     orange +      tips enabled (opt-in via `tippableIds`)
//
// Deliberately still a dumb presentational component: it owns no fetching and
// no room state. Follow is the one interactive extra, and the parent supplies
// both the known-following set and the mutation handler so this file never
// needs an auth client.

import { SpaceParticipant } from "@/types/social";
import { Check, MicOff, Plus } from "lucide-react";

interface StageGridProps {
  participants: SpaceParticipant[];
  size?: "sm" | "md" | "lg";
  // Tapping an avatar invokes this so the parent can open a per-person
  // reaction picker aimed at that participant.
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  // Active floating reaction bursts keyed by the target participant's user id.
  // Each value is a list of unique burst keys of the form "<ts>-<seq>:<emoji>".
  reactionBursts?: Record<string, string[]>;
  /**
   * The signed-in viewer's user id. Used only to suppress the follow "+" on
   * your own tile. Omit when signed out — then no follow buttons render.
   */
  viewerId?: string | null;
  /**
   * User ids the viewer already follows, so their tiles show a check instead of
   * a "+". Optional: when omitted every non-self tile starts as "+", which
   * matches the reference mockup's behaviour.
   */
  followingIds?: Set<string>;
  /**
   * Follow mutation. When absent, follow buttons are hidden entirely — which
   * keeps existing call sites visually unchanged until they opt in.
   */
  onFollow?: (userId: string) => void;
  /**
   * User ids that accept tips, rendered as the orange "+" after the name.
   */
  tippableIds?: Set<string>;
}

const sizeMap = {
  sm: {
    tile: "w-16 h-16",
    radius: "rounded-[30%]",
    name: "text-xs",
    nameWidth: "max-w-[68px]",
    grid: "grid-cols-4 sm:grid-cols-5 md:grid-cols-6",
    gap: "gap-x-2 gap-y-4",
    badge: "w-6 h-6",
    badgeIcon: "w-3 h-3",
    action: "w-5 h-5",
    actionIcon: "w-3 h-3",
  },
  // Tile widths are deliberately narrower than the grid column. grid-cols-3 with
  // a centered tile produces the wide gutters the reference room has (~67pt tile
  // in a ~122pt column on a 390pt viewport) without hand-tuning gap-x.
  md: {
    tile: "w-[72px] h-[72px] sm:w-20 sm:h-20",
    radius: "rounded-[30%]",
    name: "text-[15px] font-semibold",
    nameWidth: "max-w-[100px] sm:max-w-[112px]",
    grid: "grid-cols-3",
    gap: "gap-x-2 gap-y-6",
    badge: "w-7 h-7",
    badgeIcon: "w-3.5 h-3.5",
    action: "w-6 h-6",
    actionIcon: "w-3.5 h-3.5",
  },
  lg: {
    tile: "w-20 h-20 sm:w-24 sm:h-24",
    radius: "rounded-[30%]",
    name: "text-base font-semibold",
    nameWidth: "max-w-[112px] sm:max-w-[128px]",
    grid: "grid-cols-3",
    gap: "gap-x-2 gap-y-7",
    badge: "w-8 h-8",
    badgeIcon: "w-4 h-4",
    action: "w-7 h-7",
    actionIcon: "w-4 h-4",
  },
};

// Bottom-left status disc. Host outranks the trusted-helper badge from
// migration 017 so a host who is also flagged 'mod' reads as HOST.
function statusDisc(participant: SpaceParticipant): {
  glyph: string;
  label: string;
} | null {
  if (participant.role === "host") return { glyph: "🥇", label: "Host" };
  switch (participant.badge) {
    case "cohost":
      return { glyph: "🥈", label: "Co-host" };
    case "mod":
      return { glyph: "🛡️", label: "Moderator" };
    case "vip":
      return { glyph: "⭐", label: "VIP" };
    default:
      return null;
  }
}

export function StageGrid({
  participants,
  size = "md",
  onReactToParticipant,
  reactionBursts,
  viewerId,
  followingIds,
  onFollow,
  tippableIds,
}: StageGridProps) {
  const config = sizeMap[size];

  return (
    <div className={`grid ${config.grid} ${config.gap}`}>
      {participants.map((participant) => {
        const user = participant.user;
        const isSpeaking = participant.is_speaking && !participant.is_muted;
        const targetId = user?.id ?? participant.user_id;
        const bursts = reactionBursts?.[targetId] ?? [];
        const disc = statusDisc(participant);
        // host_muted is a host force-mute; it must show as muted even if the
        // speaker has flipped their own is_muted back off.
        const showMuted = participant.is_muted || participant.host_muted;
        const isSelf = !!viewerId && targetId === viewerId;
        const alreadyFollowing = followingIds?.has(targetId) ?? false;
        const showFollow = !!onFollow && !!viewerId && !isSelf && !!targetId;
        const showTip = tippableIds?.has(targetId) ?? false;

        return (
          <div
            key={participant.id}
            className="relative flex flex-col items-center gap-2"
          >
            {/* Targeted reaction bursts float up over this person's tile. */}
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

            <div className="relative">
              <button
                type="button"
                onClick={() => onReactToParticipant?.(participant)}
                aria-label={`React to ${user?.display_name ?? "participant"}`}
                className={`stage-avatar block cursor-pointer ${config.tile} ${
                  config.radius
                } overflow-hidden bg-melori-elevated ${
                  isSpeaking ? "speaking-ring-squircle" : ""
                }`}
              >
                <img
                  src={user?.avatar_url || "/favicon.png"}
                  className="w-full h-full object-cover"
                  alt={user?.display_name ?? ""}
                />
              </button>

              {/* Bottom-left: host / moderator / VIP disc. */}
              {disc && (
                <span
                  title={disc.label}
                  aria-label={disc.label}
                  className={`pointer-events-none absolute -bottom-1 -left-1 z-10 ${config.badge} flex items-center justify-center rounded-full bg-[#33333d] ring-2 ring-melori-void text-xs leading-none`}
                >
                  {disc.glyph}
                </span>
              )}

              {/* Bottom-right: muted indicator. Unmuted shows nothing, so a
                  quiet room reads as clean rather than covered in green dots. */}
              {showMuted && (
                <span
                  title="Muted"
                  aria-label="Muted"
                  className={`pointer-events-none absolute -bottom-1 -right-1 z-10 ${config.badge} flex items-center justify-center rounded-full bg-[#33333d] ring-2 ring-melori-void`}
                >
                  <MicOff
                    className={`${config.badgeIcon} text-melori-muted`}
                    strokeWidth={2.25}
                  />
                </span>
              )}

              {/* Top-right: follow. Sits above the tile so it stays tappable
                  without stealing the avatar's own react-on-tap gesture. */}
              {showFollow && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!alreadyFollowing) onFollow?.(targetId);
                  }}
                  disabled={alreadyFollowing}
                  aria-label={
                    alreadyFollowing
                      ? `Following ${user?.display_name ?? "participant"}`
                      : `Follow ${user?.display_name ?? "participant"}`
                  }
                  className={`absolute -top-1 -right-1 z-10 ${
                    config.action
                  } flex items-center justify-center rounded-full ring-2 ring-melori-void transition ${
                    alreadyFollowing
                      ? "bg-melori-elevated text-melori-muted"
                      : "bg-[#1d9bf0] text-white hover:brightness-110 active:scale-95"
                  }`}
                >
                  {alreadyFollowing ? (
                    <Check className={config.actionIcon} strokeWidth={3} />
                  ) : (
                    <Plus className={config.actionIcon} strokeWidth={3} />
                  )}
                </button>
              )}
            </div>

            {/* Name line: verified ✳, name, tip +. One row so every tile in a
                row has the same height regardless of which flags are set. */}
            <div
              className={`flex items-center justify-center gap-1 ${config.name} leading-none`}
            >
              {user?.verified && (
                <span
                  title="Verified"
                  aria-label="Verified"
                  className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-melori-success text-melori-void text-[10px] font-bold leading-none"
                >
                  ✳
                </span>
              )}
              <span className={`truncate ${config.nameWidth} text-melori-text`}>
                {user?.display_name}
              </span>
              {showTip && (
                <span
                  title="Accepts tips"
                  aria-label="Accepts tips"
                  className="shrink-0 font-bold text-melori-warning"
                >
                  +
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
