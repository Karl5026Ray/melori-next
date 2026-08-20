// MM Cinema — shared-screen playback sync.
//
// All of the tricky reasoning lives here as pure functions so it can be read,
// reasoned about, and tested without a browser, a room, or a video element.
// The React hook and the player component only wire these up.

export type CinemaSourceType = "url" | "youtube";

export const MAX_CINEMA_PLAYLIST_ITEMS = 5;

export interface CinemaPlaylistItem {
  id: string;
  source_type: CinemaSourceType;
  source_url: string;
  title?: string | null;
  library_video_id?: string | null;
}

export interface CinemaSourceDraft {
  source_type: CinemaSourceType;
  source_url: string;
  title?: string | null;
  library_video_id?: string | null;
}

export type CinemaPlaylistCommand =
  | { action: "append"; item: CinemaSourceDraft }
  | { action: "move"; item_id: string; to_index: number }
  | { action: "remove"; item_id: string }
  | { action: "select"; item_id: string }
  | { action: "advance"; ended_item_id: string }
  | { action: "clear" };

/** One row of `room_playback_state` (migrations 051 and 059). */
export interface PlaybackState {
  space_id: string;
  source_type: CinemaSourceType;
  source_url: string | null;
  /** Empty on legacy single-source rows until the first playlist mutation. */
  playlist_items?: CinemaPlaylistItem[];
  active_playlist_index?: number;
  playlist_revision?: number;
  /** Snapshot position AT `updated_at` — not a live clock. */
  position_seconds: number;
  duration_seconds: number | null;
  is_playing: boolean;
  updated_by: string | null;
  /** ISO timestamp, stamped by the database, never by a client. */
  updated_at: string;
}

/**
 * New clients treat a pre-playlist room as a virtual one-item queue. This lets
 * migration 059 ship without rewriting old rows (and without waking every
 * active Cinema room through Realtime just to backfill JSON).
 */
export function effectiveCinemaPlaylist(
  state: PlaybackState | null,
): CinemaPlaylistItem[] {
  if (!state) return [];
  if (Array.isArray(state.playlist_items) && state.playlist_items.length > 0) {
    return state.playlist_items.slice(0, MAX_CINEMA_PLAYLIST_ITEMS);
  }
  if (!state.source_url) return [];
  return [
    {
      id: `legacy:${state.space_id}`,
      source_type: state.source_type,
      source_url: state.source_url,
      title: "Current screening",
    },
  ];
}

export function activeCinemaPlaylistItem(
  state: PlaybackState | null,
): CinemaPlaylistItem | null {
  const items = effectiveCinemaPlaylist(state);
  if (items.length === 0) return null;
  const rawIndex =
    Array.isArray(state?.playlist_items) && state.playlist_items.length > 0
      ? Number(state.active_playlist_index ?? 0)
      : 0;
  const index = Number.isInteger(rawIndex)
    ? Math.min(Math.max(rawIndex, 0), items.length - 1)
    : 0;
  return items[index] ?? null;
}

export function cinemaPlaylistRevision(state: PlaybackState | null): number {
  const revision = Number(state?.playlist_revision ?? 0);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
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
export function planCorrection(
  local: number,
  target: number,
  opts: { allowRate?: boolean } = {},
): Correction {
  const drift = target - local; // positive: we are BEHIND and must speed up.
  const magnitude = Math.abs(drift);

  if (magnitude <= DRIFT_IGNORE_SECONDS) return { kind: "none" };
  if (magnitude > DRIFT_SEEK_SECONDS) return { kind: "seek", to: target };

  // YouTube can only play at the rates it advertises in
  // getAvailablePlaybackRates() -- 0.25/0.5/0.75/1/1.25/1.5/1.75/2. Asking for
  // 1.05 is silently ignored, and 1.25 is loudly audible on music. So for that
  // player the middle tier collapses: tolerate sub-2s drift and hard-seek past
  // it. Two tiers on YouTube is a real downgrade from three, but a downgrade
  // that works beats a correction the player throws away.
  if (opts.allowRate === false) return { kind: "none" };

  return {
    kind: "rate",
    rate: drift > 0 ? 1 + RATE_CORRECTION : 1 - RATE_CORRECTION,
  };
}

/**
 * What the shared screen needs from whatever is actually playing.
 *
 * Two players now render a Cinema room -- a plain <video> for files, and the
 * YouTube IFrame API for YouTube -- and the sync loop must not care which. It
 * talks to this instead of to an HTMLVideoElement.
 */
export interface CinemaPlayerHandle {
  getCurrentTime(): number;
  getDuration(): number | null;
  isPaused(): boolean;
  play(): void;
  pause(): void;
  seek(to: number): void;
  setRate(rate: number): void;
  setMuted(muted: boolean): void;
  /** False for YouTube, whose rate list is too coarse for fine correction. */
  supportsRateCorrection: boolean;
}

/**
 * Hosts that serve YouTube video pages. `youtube-nocookie.com` is included
 * because a host who copied an embed snippet from a privacy-conscious site
 * should not be told their link is invalid.
 */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pull the 11-character video id out of any shape of YouTube link:
 * /watch?v=, youtu.be/, /embed/, /shorts/, /live/, /v/.
 *
 * Returns null for a YouTube URL that does not name a single video -- a
 * channel, a playlist with no `v`, a search. Those cannot be screened, and the
 * host deserves to be told so rather than watching a black rectangle.
 */
export function parseYouTubeId(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }

  const v = parsed.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    segments.length >= 2 &&
    ["embed", "shorts", "live", "v"].includes(segments[0]) &&
    YOUTUBE_ID.test(segments[1])
  ) {
    return segments[1];
  }

  return null;
}

/** True when the URL points at YouTube at all, playable or not. */
export function isYouTubeHost(raw: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(raw.trim()).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/**
 * Canonical form stored in `room_playback_state.source_url`.
 *
 * Every accepted YouTube link is normalised to this before it is written, so
 * the row holds one shape regardless of whether the host pasted a Short, a
 * youtu.be link, or a watch URL trailing a playlist and a timestamp. The
 * timestamp is deliberately dropped: position belongs to the room, not the URL.
 */
export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Accepts a bare URL or a YouTube link and reports what we can actually play.
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

  const youTubeId = parseYouTubeId(url);
  if (youTubeId) {
    return { ok: true, type: "youtube", url: youTubeWatchUrl(youTubeId) };
  }
  if (isYouTubeHost(url)) {
    // A YouTube host we could not resolve to one video: a channel, a search, a
    // playlist with no `v`. Say that plainly instead of failing the file-suffix
    // check below and blaming the extension.
    return {
      ok: false,
      reason:
        "That YouTube link doesn't point at a single video. Use a normal watch link, a youtu.be link, or a Short.",
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
