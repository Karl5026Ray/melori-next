/**
 * Pure presentation math for the Concert live battle stage.
 *
 * Everything here is deliberately free of React, DOM, LiveKit, and database
 * dependencies so the score bar, gift routing, guest badges, and floating note
 * sequence can be asserted directly in `scripts/concert-stage.test.ts`. The
 * screen only renders what these functions return.
 *
 * Scores displayed on the stage are a LIVE, DISPLAY-ONLY projection of gifted
 * coins. `concert_battle_rounds` remains the authority for round outcomes; a
 * client-side total must never be written back as battle truth.
 */

import type { ConcertBattleSlot } from "@/lib/concertBattle";

/** Which competitor a value belongs to. Slot 1 renders left, slot 2 right. */
export type ConcertSide = "left" | "right";

export const CONCERT_CHAT_MAX_LENGTH = 120 as const;

/** Glyphs for the ambient tap-to-float music notes. */
export const CONCERT_NOTE_GLYPHS = ["♪", "♫", "♩", "♬", "𝄞"] as const;

export interface ConcertInstrumentGift {
  /** Matches `gifts.slug` so the catalog price stays server-authoritative. */
  slug: string;
  label: string;
  emoji: string;
  /** Auto-posted chat line when this instrument lands. */
  comment: string;
  /** Catalog price mirrored for ordering and offline tests only. */
  expectedPriceCoins: number;
}

/**
 * The five instrument gifts the battle tray offers, in ascending price order.
 * `expectedPriceCoins` documents the intended catalog value; the rendered price
 * always comes from the server catalog row so a migration can reprice without
 * a client release.
 */
export const CONCERT_INSTRUMENT_GIFTS: readonly ConcertInstrumentGift[] = [
  { slug: "battle_guitar", label: "Guitar", emoji: "🎸", comment: "guitar riff!", expectedPriceCoins: 15 },
  { slug: "battle_piano", label: "Piano", emoji: "🎹", comment: "piano drop!", expectedPriceCoins: 20 },
  { slug: "battle_drum", label: "Drum", emoji: "🥁", comment: "drum solo!", expectedPriceCoins: 30 },
  { slug: "battle_violin", label: "Violin", emoji: "🎻", comment: "violin serenade!", expectedPriceCoins: 40 },
  { slug: "battle_saxophone", label: "Sax", emoji: "🎷", comment: "sax attack!", expectedPriceCoins: 60 },
] as const;

export function concertInstrumentBySlug(
  slug: string | null | undefined,
): ConcertInstrumentGift | null {
  if (!slug) return null;
  return CONCERT_INSTRUMENT_GIFTS.find((entry) => entry.slug === slug) ?? null;
}

export type ConcertLeader = ConcertSide | "tie";

export interface ConcertScoreSplit {
  left: number;
  right: number;
  leftPercent: number;
  rightPercent: number;
  leader: ConcertLeader;
}

/**
 * Converts two raw coin totals into the proportional widths of the two-sided
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
 * Routes a gift to a competitor side. A gift aimed at anyone who is not one of
 * the two fixed competitors returns null: audience members can never be scored,
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
  left: number;
  right: number;
}

/**
 * Applies one gift to the running score. Unknown targets and non-positive coin
 * values leave the state untouched (returning the SAME object) so a duplicate
 * or malformed realtime signal cannot inflate a competitor.
 */
export function applyConcertGift(
  state: ConcertScoreState,
  gift: { targetId: string | null | undefined; coins: number },
  identities: { initiatorId: string | null | undefined; opponentId: string | null | undefined },
): ConcertScoreState {
  const side = concertSideForTarget({ targetId: gift.targetId, ...identities });
  const coins = Number.isFinite(gift.coins) ? Math.floor(gift.coins) : 0;
  if (!side || coins <= 0) return state;
  return side === "left"
    ? { left: state.left + coins, right: state.right }
    : { left: state.left, right: state.right + coins };
}

export type ConcertGuestBadge = "VIP" | "GIFTER" | "NEW";

export const CONCERT_NEW_GUEST_WINDOW_MS = 90_000 as const;

/**
 * Badge precedence is VIP, then GIFTER, then NEW. A competitor or verified
 * member outranks spend, and spend outranks recency, so one guest row never
 * shows two badges.
 */
export function concertGuestBadge(guest: {
  isCompetitor?: boolean;
  verified?: boolean | null;
  coinsGifted?: number;
  joinedAtMs?: number | null;
  nowMs?: number;
}): ConcertGuestBadge | null {
  if (guest.isCompetitor || guest.verified) return "VIP";
  if ((guest.coinsGifted ?? 0) > 0) return "GIFTER";
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

/** A gift or note currently animating over a competitor's video tile. */
export interface ConcertFloatItem {
  id: string;
  side: ConcertSide;
  glyph: string;
  offsetPercent: number;
}

export const CONCERT_FLOAT_DURATION_MS = 2_200 as const;
export const CONCERT_MAX_FLOATS_PER_SIDE = 12 as const;

/**
 * Appends a float while capping each side, so a gift-spamming audience cannot
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
