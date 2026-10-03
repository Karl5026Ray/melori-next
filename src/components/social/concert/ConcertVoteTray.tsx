"use client";

import { Loader2 } from "lucide-react";
import type { ConcertSide } from "@/lib/concertStage";

const SIDE_STYLE: Record<ConcertSide, { on: string; off: string }> = {
  left: {
    on: "border-[#ff4d6d] bg-[#ff4d6d]/25 text-white",
    off: "border-[#ff4d6d]/40 bg-[#ff4d6d]/10 text-[#ff8fa3]",
  },
  right: {
    on: "border-[#4dabff] bg-[#4dabff]/25 text-white",
    off: "border-[#4dabff]/40 bg-[#4dabff]/10 text-[#8fd0ff]",
  },
};

/**
 * Audience voting for the current round: one vote per signed-in member per
 * round, changeable until the round closes. The tray only asks the server;
 * the tally on the status bar comes back from the server, never from here.
 */
export function ConcertVoteTray({
  leftName,
  rightName,
  votedSide,
  pendingSide,
  disabledReason,
  onVote,
}: {
  leftName: string;
  rightName: string;
  /** The side the viewer has voted for this round, if any. */
  votedSide: ConcertSide | null;
  pendingSide: ConcertSide | null;
  /** When set, voting is unavailable and this explains why. */
  disabledReason: string | null;
  onVote: (side: ConcertSide) => void;
}) {
  const names: Record<ConcertSide, string> = { left: leftName, right: rightName };
  return (
    <section
      className="shrink-0 border-t border-white/[0.06] bg-[#111116] px-2 py-1.5"
      aria-label="Vote for a performer"
    >
      <div className="flex gap-1.5" role="group" data-testid="concert-vote-tray">
        {(["left", "right"] as const).map((side) => {
          const chosen = votedSide === side;
          const pending = pendingSide === side;
          return (
            <button
              key={side}
              type="button"
              onClick={() => onVote(side)}
              disabled={Boolean(disabledReason) || pending || chosen}
              aria-pressed={chosen}
              data-testid="concert-vote-option"
              data-side={side}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-extrabold uppercase tracking-[0.08em] transition active:scale-95 disabled:opacity-60 ${
                chosen ? SIDE_STYLE[side].on : SIDE_STYLE[side].off
              }`}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              <span className="truncate">
                {chosen ? `Voted ${names[side]}` : `Vote ${names[side]}`}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-white/40" data-testid="concert-vote-note">
        {disabledReason ??
          (votedSide
            ? "You can switch your vote until the round ends."
            : "One vote per round. The round goes to whoever gets more votes.")}
      </p>
    </section>
  );
}
