"use client";

import { usePlayer } from "@/components/player/PlayerProvider";
import { formatCount } from "@/lib/format";

// Lifetime audible plays for one or more legacy `tracks` rows — a single track
// (the homepage hero) or every track on a release (a Melori Favorites card).
//
// `baseline` holds the server-fetched total per track id. The player's live map
// wins over it wherever present, so the number ticks up the moment this listen
// is counted instead of waiting for a refetch.
//
// Renders NOTHING below one play. Every track starts at zero, so a badge that
// showed "0" would paper the page in zeroes and read as broken rather than as
// social proof for the artist. Callers keep the badge inside a row that exists
// either way so nothing shifts when the first play lands mid-listen.
//
// Typography is inherited from the container on purpose: the badge sits in
// text-sm copy in the hero and 11px copy on a card, and should match both.
export default function PlayCount({
  baseline,
  className = "",
}: {
  baseline: Record<number, number>;
  className?: string;
}) {
  const { playCounts } = usePlayer();

  let total = 0;
  for (const [id, count] of Object.entries(baseline)) {
    total += playCounts[Number(id)] ?? count;
  }
  if (total < 1) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 tabular-nums text-text-secondary ${className}`}
      title={`${total.toLocaleString("en-US")} ${total === 1 ? "play" : "plays"}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
      {formatCount(total)}
    </span>
  );
}
