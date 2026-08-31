// Voice-circle math for Cinema's voice-only audience.
//
// Cinema's room is one big shared screen, three fixed live-video seats, and
// everyone else listening. That "everyone else" row used to be a single
// horizontally scrolling strip, which meant a room of twenty people showed
// about five of them and hid the rest behind a swipe. It is now three balanced
// rows of circles, each wrapped in a ring that breathes with how loud that
// person actually is.
//
// Everything here is pure so the ring behaviour is unit-testable without a
// LiveKit room, a browser, or a real microphone.

/** Cinema's voice audience is presented as exactly three rows. */
export const VOICE_ROW_COUNT = 3;

/**
 * How often per-participant loudness is sampled from LiveKit (ms).
 *
 * LiveKit publishes `audioLevel` as a value to read, not an event to listen to,
 * so it must be polled. ~8 samples/sec reads as continuous motion to the eye
 * while keeping React updates far below animation frame rate.
 */
export const AUDIO_LEVEL_INTERVAL_MS = 120;

/**
 * Below this, a reported level is treated as room noise rather than speech, so
 * an idle circle sits perfectly still instead of jittering forever.
 */
export const VOICE_LEVEL_FLOOR = 0.05;

/** Smallest change worth pushing to React, to avoid re-rendering on noise. */
const LEVEL_EPSILON = 0.03;

/** Clamp anything LiveKit (or a mock) hands us into a usable 0..1 level. */
export function normalizeAudioLevel(value: unknown): number {
  const level = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (level <= VOICE_LEVEL_FLOOR) return 0;
  return level >= 1 ? 1 : level;
}

/**
 * True when two level maps differ enough to be worth re-rendering: a new or
 * dropped identity always counts, as does any level moving by more than
 * LEVEL_EPSILON. A silent room therefore produces zero updates.
 */
export function audioLevelsChanged(
  previous: Record<string, number>,
  next: Record<string, number>,
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return true;
  for (const key of nextKeys) {
    const before = previous[key];
    if (before === undefined) return true;
    if (Math.abs(before - next[key]) > LEVEL_EPSILON) return true;
  }
  return false;
}

/**
 * Fewest circles a row is allowed to hold before opening another row.
 *
 * Without this, three listeners would stack as three rows of one — a thin
 * vertical column instead of a room. Rows only open once there are enough
 * people to fill them.
 */
export const MIN_CIRCLES_PER_ROW = 3;

/**
 * Most circles the three rows will ever render, before the rest collapse into a
 * single "+N" chip.
 *
 * Cinema's whole layout is one non-scrolling viewport: the big screen, the three
 * live seats, and this block all have to fit at once. Five circles per row is
 * what a 390px phone holds without wrapping a row onto a second line, so a
 * hundred-person room cannot push the shared screen off the display.
 */
export const MAX_VISIBLE_VOICE_CIRCLES = VOICE_ROW_COUNT * 5;

/**
 * Split the audience into the people who get a circle and a count of everyone
 * else.
 *
 * Order is preserved and never reshuffled by who is talking: a circle that
 * jumped position every time its owner spoke would be unreadable.
 */
export function partitionVoiceAudience<T>(
  items: readonly T[],
  max = MAX_VISIBLE_VOICE_CIRCLES,
): { visible: T[]; hiddenCount: number } {
  if (max < 1) return { visible: [], hiddenCount: items.length };
  if (items.length <= max) return { visible: [...items], hiddenCount: 0 };
  // One slot is spent on the "+N" chip, so the chip never displaces a person
  // without accounting for itself.
  const visibleCount = max - 1;
  return {
    visible: items.slice(0, visibleCount),
    hiddenCount: items.length - visibleCount,
  };
}

/**
 * Split the audience into at most `rows` balanced rows, preserving order.
 *
 * Row count grows with the audience (1-3 people = one row, 4-6 = two, 7+ =
 * three) and remainder people land in the EARLIER rows, so the block always
 * reads as a settled shape: 5 listeners are 3/2, never 2/2/1 or 1/2/2. Rows
 * that would be empty are never emitted.
 */
export function splitVoiceRows<T>(items: readonly T[], rows = VOICE_ROW_COUNT): T[][] {
  if (rows < 1 || items.length === 0) return [];
  const rowsUsed = Math.min(rows, Math.ceil(items.length / MIN_CIRCLES_PER_ROW));
  const perRow = Math.ceil(items.length / rowsUsed);
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += perRow) {
    out.push(items.slice(index, index + perRow));
  }
  return out;
}

/**
 * Ring geometry for one voice circle.
 *
 * `scale` grows the ring outward with loudness and `opacity` brings it in from
 * nearly invisible, so a quiet room is calm and a loud speaker is unmistakable.
 * A muted participant is pinned to the resting state no matter what the last
 * sampled level was, which keeps "muted" visually absolute.
 */
export function voiceRing({
  level,
  speaking,
  muted,
}: {
  level: number;
  speaking: boolean;
  muted: boolean;
}): { scale: number; opacity: number; active: boolean } {
  if (muted) return { scale: 1, opacity: 0, active: false };
  const normalized = normalizeAudioLevel(level);
  // ActiveSpeakersChanged is the reliable on/off signal and arrives before a
  // usable level does. Give a confirmed speaker a visible floor so the ring
  // never lags behind the fact that they are talking.
  const effective = speaking ? Math.max(normalized, 0.3) : normalized;
  if (effective <= 0) return { scale: 1, opacity: 0, active: false };
  return {
    // 1.00 -> 1.34: large enough to read across a phone screen, small enough
    // that neighbouring circles in a tight grid never collide.
    scale: Number((1 + effective * 0.34).toFixed(3)),
    opacity: Number((0.25 + effective * 0.75).toFixed(3)),
    active: true,
  };
}

export default splitVoiceRows;
