/**
 * Concert Battle round lifecycle — pure planning, no I/O.
 *
 * Until now a battle could reach `round_active` and then nothing ever moved:
 * `phase_ends_at` was written, the stage counted down against it, and at zero
 * the battle simply sat there. This module is the missing state machine. It
 * decides one transition at a time from a battle row plus its rounds, and
 * nothing else — no database, no clock of its own, no network — so every rule
 * below is testable without a live room.
 *
 * The full lifecycle:
 *
 *   ready ──start──▶ round_active(1) ──expiry──▶ round_intermission
 *                          ▲                              │
 *                          └────────── expiry ────────────┘
 *   after the last regulation round: round_active(3) ──expiry──▶ completed
 *
 * Two callers drive it and both are safe to run concurrently:
 *   - a competitor's client, the moment its countdown hits zero (instant), and
 *   - /api/cron/concert-battle-rounds, once a minute (the guarantee).
 * Every write is guarded by the battle's `version`, so whichever caller loses
 * the race applies nothing rather than double-advancing.
 *
 * SCORING AUTHORITY. `concert_battle_rounds` owns outcomes. A round is won by
 * whoever received more gift coins inside that round's own window — NOT by the
 * running total on the status bar, which spans the whole battle and is display
 * only. That distinction is the entire reason rounds exist: losing round 1
 * badly must not make rounds 2 and 3 unwinnable.
 */

import {
  CONCERT_BATTLE_REGULATION_ROUNDS,
  CONCERT_BATTLE_ROUND_DURATION_SECONDS,
  type ConcertBattleStatus,
} from "./concertBattle";

/**
 * Gap between rounds. Long enough for competitors to see the round result and
 * for the audience's gifts to land visibly, short enough that a battle keeps
 * moving. Also comfortably longer than the cron's one-minute worst case is
 * short: the client advance path closes an intermission the instant it expires,
 * and the cron only has to be the backstop.
 */
export const CONCERT_BATTLE_INTERMISSION_SECONDS = 60;

/** Reasons a battle can end. Stored in concert_battles.completion_reason. */
export const CONCERT_BATTLE_COMPLETION_REASONS = [
  /** Won more rounds than the other competitor. */
  "regulation",
  /** Rounds split evenly; decided on total coins across the battle. */
  "coins_tiebreak",
  /** Dead even on rounds and on coins. No winner. */
  "draw",
] as const;

export type ConcertBattleCompletionReason =
  (typeof CONCERT_BATTLE_COMPLETION_REASONS)[number];

export type ConcertRoundState = "pending" | "active" | "finalized" | "draw";

export type ConcertRoundRow = {
  round_number: number;
  state: ConcertRoundState;
  starts_at: string | null;
  ends_at: string | null;
  winner_id: string | null;
  initiator_coins_total: number;
  opponent_coins_total: number;
};

export type ConcertBattleRow = {
  space_id: string;
  initiator_id: string;
  opponent_id: string | null;
  status: ConcertBattleStatus;
  current_round: number;
  regulation_rounds: number;
  round_duration_seconds: number;
  phase_started_at: string | null;
  phase_ends_at: string | null;
  winner_id: string | null;
  version: number;
};

/** Start a round: create/activate it and put the battle in round_active. */
export type StartRoundAction = {
  type: "start-round";
  roundNumber: number;
  startsAt: string;
  endsAt: string;
};

/**
 * A round's window has closed. The caller must total the gift coins each
 * competitor received inside [windowStart, windowEnd) and pass them to
 * `resolveConcertRound`, then apply `next`.
 */
export type FinalizeRoundAction = {
  type: "finalize-round";
  roundNumber: number;
  windowStart: string;
  windowEnd: string;
  /** What the battle does once this round is written. */
  next: "intermission" | "complete";
  /** Only set when next is "intermission". */
  intermissionEndsAt?: string;
};

/**
 * The last regulation round is already finalized but the battle was never
 * closed out (e.g. the process died between the two writes). Recoverable.
 */
export type CompleteBattleAction = { type: "complete-battle" };

export type NoopAction = {
  type: "none";
  /** Why nothing happened. Surfaced in the cron response for observability. */
  reason:
    | "terminal"
    | "not-started"
    | "no-opponent"
    | "phase-still-running"
    | "missing-deadline"
    | "no-active-round"
    | "rounds-exhausted";
};

export type ConcertRoundAction =
  | StartRoundAction
  | FinalizeRoundAction
  | CompleteBattleAction
  | NoopAction;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parse(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function regulationRounds(battle: ConcertBattleRow): number {
  const declared = Number(battle.regulation_rounds);
  return Number.isFinite(declared) && declared > 0
    ? declared
    : CONCERT_BATTLE_REGULATION_ROUNDS;
}

function roundSeconds(battle: ConcertBattleRow): number {
  const declared = Number(battle.round_duration_seconds);
  return Number.isFinite(declared) && declared > 0
    ? declared
    : CONCERT_BATTLE_ROUND_DURATION_SECONDS;
}

/**
 * Decide the single next transition for a battle, or explain why there is
 * none. Deliberately returns ONE step: chaining is the caller's business, so a
 * tick can never quietly skip a round.
 */
export function planConcertBattleTick(input: {
  battle: ConcertBattleRow;
  rounds: readonly ConcertRoundRow[];
  nowMs: number;
}): ConcertRoundAction {
  const { battle, rounds, nowMs } = input;
  const total = regulationRounds(battle);

  if (
    battle.status === "completed" ||
    battle.status === "cancelled" ||
    battle.status === "expired" ||
    battle.status === "forfeited"
  ) {
    return { type: "none", reason: "terminal" };
  }
  // A battle with one empty performer slot is not startable, and a battle
  // mid-flight whose opponent identity vanished is not advanceable either.
  if (!battle.opponent_id) return { type: "none", reason: "no-opponent" };

  if (battle.status === "selecting_opponent" || battle.status === "invited") {
    return { type: "none", reason: "not-started" };
  }

  // `ready` never auto-starts. Round 1 begins when the initiator says so, via
  // the start action — the audience should not walk into a battle already in
  // progress because a cron fired first.
  if (battle.status === "ready") {
    const finalizedCount = rounds.filter(
      (round) => round.state === "finalized" || round.state === "draw",
    ).length;
    if (finalizedCount >= total) return { type: "complete-battle" };
    return { type: "none", reason: "not-started" };
  }

  if (battle.status === "round_intermission") {
    const endsMs = parse(battle.phase_ends_at);
    // An intermission with no deadline would stall forever, so treat the
    // missing value as "expired now" rather than waiting on a clock that will
    // never arrive.
    if (endsMs !== null && nowMs < endsMs) {
      return { type: "none", reason: "phase-still-running" };
    }
    const finalized = rounds.filter(
      (round) => round.state === "finalized" || round.state === "draw",
    ).length;
    if (finalized >= total) return { type: "complete-battle" };
    const nextNumber = finalized + 1;
    return {
      type: "start-round",
      roundNumber: nextNumber,
      startsAt: iso(nowMs),
      endsAt: iso(nowMs + roundSeconds(battle) * 1_000),
    };
  }

  if (battle.status === "round_active") {
    const active = rounds.find((round) => round.state === "active");
    if (!active) return { type: "none", reason: "no-active-round" };
    const endsMs = parse(active.ends_at) ?? parse(battle.phase_ends_at);
    if (endsMs === null) return { type: "none", reason: "missing-deadline" };
    if (nowMs < endsMs) return { type: "none", reason: "phase-still-running" };

    const startsMs = parse(active.starts_at) ?? parse(battle.phase_started_at);
    const isLast = active.round_number >= total;
    return {
      type: "finalize-round",
      roundNumber: active.round_number,
      // Fall back to the round's end minus its duration if the start was never
      // recorded: a window that spans the whole battle would credit round 1's
      // gifts to round 3.
      windowStart: iso(startsMs ?? endsMs - roundSeconds(battle) * 1_000),
      windowEnd: iso(endsMs),
      next: isLast ? "complete" : "intermission",
      ...(isLast
        ? {}
        : {
            intermissionEndsAt: iso(
              nowMs + CONCERT_BATTLE_INTERMISSION_SECONDS * 1_000,
            ),
          }),
    };
  }

  return { type: "none", reason: "rounds-exhausted" };
}

/** Can the initiator start round 1 right now? */
export function canStartConcertRound(battle: ConcertBattleRow): boolean {
  return battle.status === "ready" && Boolean(battle.opponent_id);
}

/**
 * Build the round-1 start action for the initiator's explicit start.
 * Separate from the tick planner because this transition is intentional, not
 * deadline-driven.
 */
export function planConcertRoundStart(
  battle: ConcertBattleRow,
  nowMs: number,
): StartRoundAction | NoopAction {
  if (!battle.opponent_id) return { type: "none", reason: "no-opponent" };
  if (!canStartConcertRound(battle)) {
    return {
      type: "none",
      reason: battle.status === "round_active" ? "phase-still-running" : "not-started",
    };
  }
  return {
    type: "start-round",
    roundNumber: 1,
    startsAt: iso(nowMs),
    endsAt: iso(nowMs + roundSeconds(battle) * 1_000),
  };
}

/**
 * Decide a single round from the coins each competitor received inside that
 * round's window. An exact tie is a real outcome, not an error: the schema has
 * a dedicated `draw` state for it.
 */
export function resolveConcertRound(input: {
  initiatorId: string;
  opponentId: string;
  initiatorCoins: number;
  opponentCoins: number;
}): { state: "finalized" | "draw"; winnerId: string | null } {
  const initiator = Math.max(0, Math.trunc(input.initiatorCoins || 0));
  const opponent = Math.max(0, Math.trunc(input.opponentCoins || 0));
  if (initiator === opponent) return { state: "draw", winnerId: null };
  return {
    state: "finalized",
    winnerId: initiator > opponent ? input.initiatorId : input.opponentId,
  };
}

/**
 * Decide the battle from its finished rounds.
 *
 * Rounds won comes first, because that is what the format promises. Total coins
 * only breaks a tie in rounds won — so a competitor who wins two rounds
 * narrowly still beats one who wins a single round by a landslide. Dead even on
 * both is a draw, and a draw stores no winner (the schema requires any winner
 * to be one of the two competitors, and there is no honest choice here).
 */
export function resolveConcertBattleOutcome(input: {
  initiatorId: string;
  opponentId: string;
  rounds: readonly ConcertRoundRow[];
}): {
  winnerId: string | null;
  completionReason: ConcertBattleCompletionReason;
  initiatorRoundsWon: number;
  opponentRoundsWon: number;
  initiatorCoins: number;
  opponentCoins: number;
} {
  const decided = input.rounds.filter(
    (round) => round.state === "finalized" || round.state === "draw",
  );
  let initiatorRoundsWon = 0;
  let opponentRoundsWon = 0;
  let initiatorCoins = 0;
  let opponentCoins = 0;
  for (const round of decided) {
    if (round.winner_id === input.initiatorId) initiatorRoundsWon += 1;
    else if (round.winner_id === input.opponentId) opponentRoundsWon += 1;
    initiatorCoins += Math.max(0, Number(round.initiator_coins_total) || 0);
    opponentCoins += Math.max(0, Number(round.opponent_coins_total) || 0);
  }

  let winnerId: string | null = null;
  let completionReason: ConcertBattleCompletionReason = "draw";
  if (initiatorRoundsWon !== opponentRoundsWon) {
    winnerId =
      initiatorRoundsWon > opponentRoundsWon ? input.initiatorId : input.opponentId;
    completionReason = "regulation";
  } else if (initiatorCoins !== opponentCoins) {
    winnerId = initiatorCoins > opponentCoins ? input.initiatorId : input.opponentId;
    completionReason = "coins_tiebreak";
  }

  return {
    winnerId,
    completionReason,
    initiatorRoundsWon,
    opponentRoundsWon,
    initiatorCoins,
    opponentCoins,
  };
}

/**
 * Countdown for whichever phase is running.
 *
 * `formatConcertBattlePhaseTimer` in ./concertBattle deliberately shows a timer
 * only for a live round. Once intermissions exist the audience needs to see the
 * gap counting down too, otherwise the stage looks frozen between rounds.
 */
export function formatConcertPhaseCountdown(
  timing: { status: ConcertBattleStatus; phase_ends_at?: string | null },
  nowMs = Date.now(),
): string {
  if (
    timing.status !== "round_active" &&
    timing.status !== "round_intermission"
  ) {
    return "--:--";
  }
  const endsMs = parse(timing.phase_ends_at);
  if (endsMs === null) return "--:--";
  const seconds = Math.max(0, Math.ceil((endsMs - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Has the current phase's deadline passed? Drives the client's advance call. */
export function isConcertPhaseExpired(
  timing: { status: ConcertBattleStatus; phase_ends_at?: string | null },
  nowMs = Date.now(),
): boolean {
  if (
    timing.status !== "round_active" &&
    timing.status !== "round_intermission"
  ) {
    return false;
  }
  const endsMs = parse(timing.phase_ends_at);
  if (endsMs === null) return timing.status === "round_intermission";
  return nowMs >= endsMs;
}

/** Label for the stage: "Round 2 of 3", or the phase when no round is running. */
export function formatConcertRoundLabel(battle: {
  status: ConcertBattleStatus;
  current_round: number;
  regulation_rounds: number;
}): string {
  const total = Number(battle.regulation_rounds) || CONCERT_BATTLE_REGULATION_ROUNDS;
  const current = Number(battle.current_round) || 0;
  if (battle.status === "round_active") return `Round ${current} of ${total}`;
  if (battle.status === "round_intermission") {
    return current >= total ? "Final scores" : `Round ${current} done · next up`;
  }
  if (battle.status === "completed") return "Battle over";
  if (battle.status === "ready") return `Ready · ${total} rounds`;
  return "Warming up";
}
