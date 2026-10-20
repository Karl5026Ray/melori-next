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
 * Spaces' three concentric speaking rings, inner to outer. Each band starts
 * filling at its threshold and is full one span later: a soft voice lights the
 * inner ring, a loud one lights all three, so the rings fill outward from the
 * avatar as speech gets louder (Karl, 20 Oct 2026). Cinema keeps its own copy
 * in src/lib/voiceCircles.ts — the products do not share room UI code.
 */
export const SPACES_RING_THRESHOLDS = [0, 0.25, 0.5] as const;
const SPACES_RING_SPAN = 0.25;
const SPACES_RING_WEIGHT = [1, 0.8, 0.6] as const;
export type SpacesRingBands = readonly [number, number, number];
const SPACES_SILENT_BANDS: SpacesRingBands = [0, 0, 0];

export function spacesRingBands(effective: number): SpacesRingBands {
  const e = Number.isFinite(effective) ? Math.max(0, Math.min(1, effective)) : 0;
  const band = (i: 0 | 1 | 2) => {
    const fill = Math.max(0, Math.min(1, (e - SPACES_RING_THRESHOLDS[i]) / SPACES_RING_SPAN));
    if (fill <= 0 || e <= 0) return 0;
    return Number(((0.35 + 0.65 * fill) * SPACES_RING_WEIGHT[i]).toFixed(3));
  };
  return [band(0), band(1), band(2)];
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
}): { scale: number; opacity: number; active: boolean; bands: SpacesRingBands } {
  if (input.muted) return { scale: 1, opacity: 0, active: false, bands: SPACES_SILENT_BANDS };
  const level = Number.isFinite(input.level) ? Math.max(0, Math.min(1, input.level)) : 0;
  const effective = input.speaking ? Math.max(level, 0.3) : level;
  if (effective <= 0) return { scale: 1, opacity: 0, active: false, bands: SPACES_SILENT_BANDS };
  return {
    bands: spacesRingBands(effective),
    scale: Number((1 + effective * 0.22).toFixed(3)),
    opacity: Number((0.35 + effective * 0.65).toFixed(3)),
    active: true,
  };
}
