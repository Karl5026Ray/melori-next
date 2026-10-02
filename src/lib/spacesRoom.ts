// src/lib/spacesRoom.ts
//
// MM Spaces room rules: who sits on the stage, how many, and how a speaking
// ring looks. Pure functions so the participants route (server) and
// SpacesRoomScreen (client) read the same rule.
//
// Spaces' own file. Cinema has its own equivalents in src/lib/cinemaStage.ts;
// the two products do not share room code (Karl, 2 Oct 2026).

/** Speakers allowed on a Spaces stage besides the host (Clubhouse-style room). */
export const SPACES_SPEAKER_LIMIT = 8;

export interface SpacesStageRow {
  user_id: string;
  role?: string | null;
  left_at?: string | null;
}

/** Speakers currently on stage, not counting the host. */
export function spacesSpeakerCount(rows: readonly SpacesStageRow[], hostId: string): number {
  return rows.filter((row) => !row.left_at && row.role === "speaker" && row.user_id !== hostId)
    .length;
}

/** May one more speaker come up? Re-promoting someone already up is never refused. */
export function spacesStageHasRoom(
  rows: readonly SpacesStageRow[],
  hostId: string,
  targetId?: string,
): boolean {
  const others = rows.filter((row) => row.user_id !== targetId);
  return spacesSpeakerCount(others, hostId) < SPACES_SPEAKER_LIMIT;
}

/**
 * The stage in display order: the host first, then speakers in roster order
 * (the roster arrives ordered by joined_at, so seats do not reshuffle when
 * someone mutes). A former host still marked "host" after a hand-off is shown
 * as a speaker, after the current host.
 */
export function buildSpacesStage<T extends SpacesStageRow>(
  rows: readonly T[],
  hostId: string,
): T[] {
  const live = rows.filter((row) => !row.left_at);
  const host = live.find((row) => row.user_id === hostId);
  const speakers = live.filter(
    (row) => row.user_id !== hostId && (row.role === "speaker" || row.role === "host"),
  );
  return host ? [host, ...speakers] : speakers;
}

/**
 * Speaking ring for a stage circle. `level` is LiveKit loudness 0..1; the
 * on/off speaking flag gives a visible floor so the ring never lags behind
 * someone who has started talking. A muted person never rings.
 */
export function spacesRing(input: {
  level: number;
  speaking: boolean;
  muted: boolean;
}): { scale: number; opacity: number; active: boolean } {
  if (input.muted) return { scale: 1, opacity: 0, active: false };
  const level = Number.isFinite(input.level) ? Math.max(0, Math.min(1, input.level)) : 0;
  const effective = input.speaking ? Math.max(level, 0.3) : level;
  if (effective <= 0) return { scale: 1, opacity: 0, active: false };
  return {
    scale: Number((1 + effective * 0.22).toFixed(3)),
    opacity: Number((0.35 + effective * 0.65).toFixed(3)),
    active: true,
  };
}
