"use client";

import {
  concertScoreSplit,
  formatConcertScore,
  type ConcertLeader,
} from "@/lib/concertStage";

/**
 * The battle's top status band: both coin scores, a pulsing LIVE badge, the
 * phase countdown, and a two-sided proportional bar showing who is ahead.
 *
 * All geometry comes from concertScoreSplit so the bar can be asserted without
 * a browser. The leading side is also marked with data attributes rather than
 * colour alone, which is what lets a screen reader and a test both read the
 * outcome.
 */
export function ConcertBattleStatusBar({
  leftScore,
  rightScore,
  timerLabel,
  isLive,
  roundLabel,
}: {
  leftScore: number;
  rightScore: number;
  timerLabel: string;
  isLive: boolean;
  roundLabel?: string;
}) {
  const split = concertScoreSplit(leftScore, rightScore);
  const leaderLabel: Record<ConcertLeader, string> = {
    left: "Left competitor leads",
    right: "Right competitor leads",
    tie: "Scores are tied",
  };

  return (
    <section
      className="shrink-0 border-b border-white/[0.06] bg-[#111116] px-3 pb-1.5 pt-1.5"
      data-testid="concert-status-bar"
      data-leader={split.leader}
      aria-label="Battle score"
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="min-w-0 flex-1 truncate text-left text-[17px] font-extrabold tabular-nums text-[#ff4d6d] [text-shadow:0_0_14px_rgba(255,77,109,0.55)]"
          data-testid="concert-score-left"
        >
          {formatConcertScore(split.left)}
        </p>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[#ff2d55] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.1em] text-white"
            data-testid="concert-live-badge"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-white ${isLive ? "animate-pulse" : "opacity-50"}`}
              aria-hidden
            />
            {isLive ? "Live" : "Paused"}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[#f5e56b]/30 bg-[#f5e56b]/10 px-2 py-[3px] text-[11px] font-bold tabular-nums text-[#f5e56b]"
            data-testid="concert-timer"
          >
            <span aria-hidden>⏳</span>
            <span className="sr-only">Time remaining </span>
            {timerLabel}
          </span>
        </div>

        <p
          className="min-w-0 flex-1 truncate text-right text-[17px] font-extrabold tabular-nums text-[#4dabff] [text-shadow:0_0_14px_rgba(77,171,255,0.55)]"
          data-testid="concert-score-right"
        >
          {formatConcertScore(split.right)}
        </p>
      </div>

      <div
        className="mt-1 flex h-[6px] w-full overflow-hidden rounded-full bg-black/60"
        role="img"
        aria-label={`${leaderLabel[split.leader]}. ${formatConcertScore(split.left)} to ${formatConcertScore(split.right)} coins.`}
        data-testid="concert-status-track"
      >
        <span
          className="h-full bg-gradient-to-r from-[#ff2d55] to-[#ff8fa3] transition-[width] duration-500 ease-out"
          style={{ width: `${split.leftPercent}%` }}
          data-testid="concert-status-fill-left"
          data-percent={split.leftPercent}
        />
        <span
          className="h-full bg-gradient-to-l from-[#1f8fff] to-[#8fd0ff] transition-[width] duration-500 ease-out"
          style={{ width: `${split.rightPercent}%` }}
          data-testid="concert-status-fill-right"
          data-percent={split.rightPercent}
        />
      </div>

      {roundLabel ? (
        <p className="mt-0.5 text-center text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">
          {roundLabel}
        </p>
      ) : null}
    </section>
  );
}
