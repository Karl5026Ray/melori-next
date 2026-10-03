/**
 * Pure presentation math for the Concert live battle stage.
 *
 * Everything here is deliberately free of React, DOM, LiveKit, and database
 * dependencies so the score bar, vote routing, guest badges, and floating note
 * sequence can be asserted directly in `scripts/concert-stage.test.ts`. The
 * screen only renders what these functions return.
 *
 * Scores on the stage are the AUDIENCE VOTE tally for the current round: one
 * vote per signed-in member per round. The server owns the tally (it counts
 * `concert_votes` rows and broadcasts the totals); the client only displays
 * the latest totals it was given and never computes a score of its own.
 */

import type { ConcertBattleSlot } from "@/lib/concertBattle";

/** Which competitor a value belongs to. Slot 1 renders left, slot 2 right. */
export type ConcertSide = "left" | "right";

export const CONCERT_CHAT_MAX_LENGTH = 120 as const;

/** Glyphs for the ambient tap-to-float music notes. */
export const CONCERT_NOTE_GLYPHS = ["♪", "♫", "♩", "♬", "𝄞"] as const;

export type ConcertLeader = ConcertSide | "tie";

export interface ConcertScoreSplit {
  left: number;
  right: number;
  leftPercent: number;
  rightPercent: number;
  leader: ConcertLeader;
}

/**
 * Converts two vote totals into the proportional widths of the two-sided
 * "who is winning" bar. A scoreless battle renders an even 50/50 split rather
 * than an empty bar, and negative or non-finite input is clamped to zero so a
 * bad realtime payload cannot produce a NaN width.
 */
export function concertScoreSplit(
  leftScore: number,
  rightScore: number,
): ConcertScoreSplit {
  const left = Number.isFinite(leftScore) ? Math.max(0, Math.floor(leftScore)) : 0;
  const right = Number.isFinite(rightScore) ? Math.max(0, Math.floor(rightScore)) : 0;
  const total = left + right;
  const leftPercent = total === 0 ? 50 : Math.round((left / total) * 1000) / 10;
  return {
    left,
    right,
    leftPercent,
    rightPercent: Math.round((100 - leftPercent) * 10) / 10,
    leader: left === right ? "tie" : left > right ? "left" : "right",
  };
}

export function concertSideForSlot(slot: ConcertBattleSlot): ConcertSide {
  return slot === 1 ? "left" : "right";
}

/**
 * Routes a vote to a competitor side. A vote for anyone who is not one of the
 * two fixed competitors returns null: audience members can never be scored,
 * which is what keeps the score bar tied to the battle's immutable identities.
 */
export function concertSideForTarget(args: {
  targetId: string | null | undefined;
  initiatorId: string | null | undefined;
  opponentId: string | null | undefined;
}): ConcertSide | null {
  if (!args.targetId) return null;
  if (args.initiatorId && args.targetId === args.initiatorId) return "left";
  if (args.opponentId && args.targetId === args.opponentId) return "right";
  return null;
}

export interface ConcertScoreState {
  /** The round these totals belong to. 0 before round 1 starts. */
  round: number;
  left: number;
  right: number;
}

/** A server-computed tally, as broadcast after every vote. */
export interface ConcertVoteTally {
  round: number;
  initiatorVotes: number;
  opponentVotes: number;
}

function wholeVotes(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Applies a server tally to the displayed score. Tallies are ABSOLUTE (the
 * server sends the full count, never a delta), so a duplicate or reordered
 * realtime message cannot inflate a competitor. A tally for a different round
 * than the one on screen, or with malformed counts, leaves the state untouched
 * (returning the SAME object).
 */
export function applyConcertVoteTally(
  state: ConcertScoreState,
  tally: ConcertVoteTally,
): ConcertScoreState {
  const round = Number.isFinite(tally.round) ? Math.trunc(tally.round) : NaN;
  if (round !== state.round) return state;
  const left = wholeVotes(tally.initiatorVotes);
  const right = wholeVotes(tally.opponentVotes);
  if (left === null || right === null) return state;
  if (left === state.left && right === state.right) return state;
  return { round, left, right };
}

export type ConcertGuestBadge = "VIP" | "NEW";

export const CONCERT_NEW_GUEST_WINDOW_MS = 90_000 as const;

/**
 * Badge precedence is VIP, then NEW. A competitor or verified member outranks
 * recency, so one guest row never shows two badges.
 */
export function concertGuestBadge(guest: {
  isCompetitor?: boolean;
  verified?: boolean | null;
  joinedAtMs?: number | null;
  nowMs?: number;
}): ConcertGuestBadge | null {
  if (guest.isCompetitor || guest.verified) return "VIP";
  const joinedAtMs = guest.joinedAtMs;
  if (joinedAtMs != null && Number.isFinite(joinedAtMs)) {
    const now = guest.nowMs ?? Date.now();
    if (now - joinedAtMs <= CONCERT_NEW_GUEST_WINDOW_MS) return "NEW";
  }
  return null;
}

/**
 * Deterministic note glyph selection. Taking a counter rather than calling
 * Math.random keeps the float animation testable and gives an even spread
 * instead of visible repeats.
 */
export function concertNoteGlyph(sequence: number): string {
  const index = Math.abs(Math.trunc(sequence)) % CONCERT_NOTE_GLYPHS.length;
  return CONCERT_NOTE_GLYPHS[index];
}

/** Horizontal drift, in percent of the tile, for a floating item. */
export function concertFloatOffset(sequence: number): number {
  const spread = [-26, 14, -8, 30, -18, 6, 22, -32];
  return spread[Math.abs(Math.trunc(sequence)) % spread.length];
}

export function formatConcertScore(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return safe.toLocaleString("en-US");
}

/** A vote or note currently animating over a competitor's video tile. */
export interface ConcertFloatItem {
  id: string;
  side: ConcertSide;
  glyph: string;
  offsetPercent: number;
}

export const CONCERT_FLOAT_DURATION_MS = 2_200 as const;
export const CONCERT_MAX_FLOATS_PER_SIDE = 12 as const;

/**
 * Appends a float while capping each side, so a tap-happy audience cannot
 * grow an unbounded animation list and stall a mobile browser.
 */
export function pushConcertFloat(
  items: readonly ConcertFloatItem[],
  item: ConcertFloatItem,
): ConcertFloatItem[] {
  const next = [...items, item];
  const sideCount = next.filter((entry) => entry.side === item.side).length;
  if (sideCount <= CONCERT_MAX_FLOATS_PER_SIDE) return next;
  const dropId = next.find((entry) => entry.side === item.side)?.id;
  return next.filter((entry) => entry.id !== dropId);
}
