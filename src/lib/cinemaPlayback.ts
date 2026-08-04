// MM Cinema — shared-screen playback sync.
//
// All of the tricky reasoning lives here as pure functions so it can be read,
// reasoned about, and tested without a browser, a room, or a video element.
// The React hook and the player component only wire these up.

export type CinemaSourceType = "url" | "youtube";

/** One row of `room_playback_state` (migration 051). */
export interface PlaybackState {
  space_id: string;
  source_type: CinemaSourceType;
  source_url: string | null;
  /** Snapshot position AT `updated_at` — not a live clock. */
  position_seconds: number;
  duration_seconds: number | null;
  is_playing: boolean;
  updated_by: string | null;
  /** ISO timestamp, stamped by the database, never by a client. */
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * Below this, do nothing.
 *
 * Human beings do not perceive a quarter-second offset between two people
 * watching the same video in different rooms, and chasing it would mean
 * constantly nudging playback — which IS perceptible. Silence is the correct
 * response to small drift.
 */
export const DRIFT_IGNORE_SECONDS = 0.25;

/**
 * Above this, hard seek.
 *
 * Past ~2s the room is visibly out of step — someone reacts in chat to a lyric
 * you have not heard yet. A seek is jarring but brief; staying wrong is worse.
 */
export const DRIFT_SEEK_SECONDS = 2;

/**
 * Between IGNORE and SEEK, correct by changing playback RATE instead of
 * jumping. Running 5% fast or slow is inaudible on speech and music but closes
 * a one-second gap in about twenty seconds, with no visible discontinuity.
 */
export const RATE_CORRECTION = 0.05;

/** How often the host re-stamps position while playing. */
export const HOST_HEARTBEAT_MS = 10_000;

/**
 * The heartbeat is NOT what keeps the room in sync — extrapolation from
 * `updated_at` already does that, and a playing room stays correct with zero
 * writes. The heartbeat exists to bound the damage from the things
 * extrapolation cannot see: the host buffering, the host's tab being throttled
 * in the background, or a dropped realtime event. Ten seconds is frequent
 * enough to catch those and slow enough to stay negligible as write load.
 */

// ---------------------------------------------------------------------------
// Clock skew
// ---------------------------------------------------------------------------

/**
 * Guests extrapolate using `now - updated_at`, where `updated_at` is the
 * DATABASE clock and `now` is the BROWSER clock. If those disagree — and on
 * consumer devices they routinely disagree by seconds — every guest sits at a
 * constant offset that no amount of drift correction can fix, because each
 * client believes it is already correct.
 *
 * So we measure the offset once against a server-supplied timestamp and apply
 * it to every subsequent reading.
 *
 *   offset = serverNow - clientNow   (positive: our clock is behind)
 */
export function computeClockOffsetMs(
  serverNowIso: string,
  clientNowMs: number = Date.now(),
): number {
  const serverMs = new Date(serverNowIso).getTime();
  if (Number.isNaN(serverMs)) return 0;
  return serverMs - clientNowMs;
}

/**
 * Where playback SHOULD be right now, according to the host.
 *
 * A paused room is simply its snapshot — no extrapolation, because time is not
 * advancing. A playing room advances from the snapshot by however long ago the
 * snapshot was taken. This is why a playing room needs no writes to stay
 * accurate.
 */
export function targetPosition(
  state: PlaybackState,
  clockOffsetMs: number = 0,
  clientNowMs: number = Date.now(),
): number {
  const base = Number(state.position_seconds) || 0;
  if (!state.is_playing) return base;

  const stampedAt = new Date(state.updated_at).getTime();
  if (Number.isNaN(stampedAt)) return base;

  const elapsedSeconds = (clientNowMs + clockOffsetMs - stampedAt) / 1000;

  // Guard against a nonsense negative elapsed (badly skewed clock, or a row
  // stamped slightly in the future relative to this reader). Extrapolating
  // backwards would rewind everyone.
  const advanced = base + Math.max(0, elapsedSeconds);

  // Never extrapolate past the end of the file. Without this, a room left
  // playing overnight reports a position hours beyond the runtime, and every
  // guest hard-seeks to a point that does not exist.
  const duration = state.duration_seconds ? Number(state.duration_seconds) : null;
  if (duration && duration > 0) return Math.min(advanced, duration);

  return advanced;
}

export type Correction =
  | { kind: "none" }
  | { kind: "seek"; to: number }
  | { kind: "rate"; rate: number };

/**
 * Decide how a guest should reconcile its local position with the host's.
 *
 * Three-tier on purpose. A seek-only strategy would visibly stutter the room
 * every few seconds on a slightly slow connection; a rate-only strategy would
 * take minutes to recover from a real gap, or never recover at all if the
 * guest joined late.
 */
export function planCorrection(local: number, target: number): Correction {
  const drift = target - local; // positive: we are BEHIND and must speed up.
  const magnitude = Math.abs(drift);

  if (magnitude <= DRIFT_IGNORE_SECONDS) return { kind: "none" };
  if (magnitude > DRIFT_SEEK_SECONDS) return { kind: "seek", to: target };

  return {
    kind: "rate",
    rate: drift > 0 ? 1 + RATE_CORRECTION : 1 - RATE_CORRECTION,
  };
}

/**
 * Accepts a bare URL, or a YouTube link, and reports what we can actually
 * play. v1 only implements direct files; YouTube is detected so the host gets
 * a straight answer instead of a silently black screen.
 */
export function classifySource(
  raw: string,
): { ok: true; type: CinemaSourceType; url: string } | { ok: false; reason: string } {
  const url = raw.trim();
  if (!url) return { ok: false, reason: "Paste a video link to get started." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid link." };
  }

  if (parsed.protocol !== "https:") {
    // Browsers block mixed content on an https page, so an http source would
    // fail at play time with a console error and no visible cause.
    return { ok: false, reason: "The link needs to be https." };
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    return {
      ok: false,
      reason:
        "YouTube isn't supported yet — it needs its own player. Use a direct video link (.mp4 or .m3u8) for now.",
    };
  }

  const path = parsed.pathname.toLowerCase();
  const looksPlayable =
    path.endsWith(".mp4") ||
    path.endsWith(".m3u8") ||
    path.endsWith(".webm") ||
    path.endsWith(".mov");

  if (!looksPlayable) {
    return {
      ok: false,
      reason: "Use a direct video file link ending in .mp4, .m3u8, .webm, or .mov.",
    };
  }

  return { ok: true, type: "url", url };
}

/** mm:ss, or h:mm:ss once past an hour. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
