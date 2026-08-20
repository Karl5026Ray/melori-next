/**
 * Pure Concert Battle domain contracts.
 *
 * A Concert Battle is deliberately not a generic Space stage: its performer
 * identity is durable and positional. The initiator always owns slot 1; an
 * accepted opponent, when present, always owns slot 2.
 */

export const CONCERT_BATTLE_ROOM_FORMAT = "versus_battle" as const;
export const CONCERT_BATTLE_REGULATION_ROUNDS = 3 as const;
export const CONCERT_BATTLE_ROUND_DURATION_SECONDS = 240 as const;

export const CONCERT_BATTLE_STATUSES = [
  "selecting_opponent",
  "invited",
  "ready",
  "round_active",
  "round_intermission",
  "completed",
  "cancelled",
  "expired",
  "forfeited",
] as const;

export type ConcertBattleStatus = (typeof CONCERT_BATTLE_STATUSES)[number];

export const CONCERT_BATTLE_ROUND_STATUSES = [
  "pending",
  "active",
  "finalized",
  "draw",
] as const;

export type ConcertBattleRoundStatus =
  (typeof CONCERT_BATTLE_ROUND_STATUSES)[number];

export const CONCERT_BATTLE_INVITE_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
] as const;

export type ConcertBattleInviteStatus =
  (typeof CONCERT_BATTLE_INVITE_STATUSES)[number];

export type ConcertBattleSlot = 1 | 2;

export type ConcertBattleIdentity = {
  initiator_id: string;
  opponent_id?: string | null;
};

export type ConcertBattleTiming = {
  status: ConcertBattleStatus;
  phase_ends_at?: string | null;
};

export const CONCERT_BATTLE_TERMINAL_STATUSES = new Set<ConcertBattleStatus>([
  "completed",
  "cancelled",
  "expired",
  "forfeited",
]);

/** Returns the immutable performer slot for an identity, or null for viewers. */
export function getConcertBattleSlot(
  battle: ConcertBattleIdentity | null | undefined,
  userId: string | null | undefined,
): ConcertBattleSlot | null {
  if (!battle || !userId) return null;
  if (battle.initiator_id === userId) return 1;
  return battle.opponent_id === userId ? 2 : null;
}

/** A durable opponent identity is created only by accepting a battle invite. */
export function hasAcceptedConcertOpponent(
  battle: ConcertBattleIdentity | null | undefined,
): boolean {
  return Boolean(battle?.opponent_id);
}

export function isConcertBattleTerminal(
  status: ConcertBattleStatus | null | undefined,
): boolean {
  return status != null && CONCERT_BATTLE_TERMINAL_STATUSES.has(status);
}

export function canConcertBattlePerform(
  status: ConcertBattleStatus | null | undefined,
): boolean {
  return (
    status === "ready" ||
    status === "round_active" ||
    status === "round_intermission"
  );
}

/**
 * Calculates a display-only countdown. Database/RPC checks remain the source
 * of truth for all battle deadlines.
 */
export function getConcertBattleSecondsRemaining(
  endsAt: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!endsAt) return null;
  const endsMs = Date.parse(endsAt);
  if (Number.isNaN(endsMs)) return null;
  return Math.max(0, Math.ceil((endsMs - nowMs) / 1_000));
}

export function formatConcertBattleTimer(
  seconds: number | null | undefined,
): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function formatConcertBattlePhaseTimer(
  timing: ConcertBattleTiming | null | undefined,
  nowMs = Date.now(),
): string {
  if (!timing || timing.status !== "round_active") return "--:--";
  return formatConcertBattleTimer(
    getConcertBattleSecondsRemaining(timing.phase_ends_at, nowMs),
  );
}
