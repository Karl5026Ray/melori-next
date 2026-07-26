"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { authHeaders } from "@/lib/authClient";

// A PlayerTrack refers to either a row in the legacy `tracks` table (integer
// PK) or a row in `studio_tracks` (UUID PK). We keep `id` typed as the union
// so callers don't have to coerce, and use `sourceType` to route to the
// correct signed-URL endpoint. Legacy is the default because the majority of
// existing callers still use the old table.
export type TrackSource = "legacy" | "studio";

export interface PlayerTrack {
  id: number | string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  // Optional — defaults to "legacy" so pre-existing callers keep working.
  sourceType?: TrackSource;
  // Optional extras carried by radio pool rows (RadioTrack). Declaring them
  // here lets a RadioTrack be queued directly and lets the OS media session
  // publish an album name.
  album?: string | null;
  score?: number;
}

// Stable string key used for internal equality checks (e.g. "is this track
// currently loaded?"). Distinguishing by source type prevents a collision
// where a legacy tracks.id=5 would appear equal to a studio_tracks.id whose
// string happens to be "5".
function trackKey(t: { id: number | string; sourceType?: TrackSource }): string {
  return `${t.sourceType ?? "legacy"}:${t.id}`;
}

// Resolve the correct signed-URL endpoint for a track based on its source.
function streamUrlFor(t: PlayerTrack): string {
  return t.sourceType === "studio"
    ? `/api/studio/tracks/${t.id}/stream`
    : `/api/tracks/${t.id}/stream`;
}

// Build a radio rotation. `preserveOrder` (saved playlists) returns the list
// untouched. Otherwise: when tracks carry a `score` (the "For You" station) we
// draw without replacement using Efraimidis–Spirakis weighting so higher-scored
// tracks tend to land earlier, but it stays probabilistic so discovery tracks
// still surface. A repair pass then avoids the same artist back-to-back.
function buildRotation(
  pool: PlayerTrack[],
  preserveOrder: boolean,
): PlayerTrack[] {
  if (preserveOrder) return [...pool];
  const hasScores = pool.some((t) => typeof t.score === "number" && t.score > 0);
  let arr: PlayerTrack[];
  if (hasScores) {
    arr = [...pool]
      .map((t) => {
        const w = Math.max(0.01, (t.score ?? 0) + 0.5); // floor so score-0 still plays
        return { t, key: Math.pow(Math.random(), 1 / w) };
      })
      .sort((a, b) => b.key - a.key)
      .map((x) => x.t);
  } else {
    arr = [...pool];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].artistName && arr[i].artistName === arr[i - 1].artistName) {
      let k = i + 1;
      while (k < arr.length && arr[k].artistName === arr[i - 1].artistName) k++;
      if (k < arr.length) [arr[i], arr[k]] = [arr[k], arr[i]];
    }
  }
  return arr;
}

interface PlayerContextValue {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number; // seconds
  duration: number; // seconds
  volume: number; // 0..1
  // Muted mirrors the <audio> element's own `muted` flag. Used by the homepage
  // hero, which starts playback MUTED (the only way browsers allow autoplay)
  // and unmutes on the visitor's first interaction.
  muted: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  // True while the current track is a free 30s preview (not full access).
  isSample: boolean;
  // True once a free preview has hit its 30s cap and playback was stopped.
  sampleEnded: boolean;
  // Radio mode: the shared player is fed the whole shuffled catalog and
  // auto-reshuffles forever, so "Radio" is just a toggle on the one bar the
  // user already sees — no separate page or second audio engine.
  radioMode: boolean;
  radioLoading: boolean;
  // Identity of the station currently on air ("all", "foryou",
  // "playlist:<id>"). Lets the Radio page tell "this station is already
  // playing" from "the user switched stations", so opening /social/radio while
  // the homepage station plays never restarts or double-starts audio.
  radioStationKey: string | null;
  startRadio: (
    mode?: "all" | "foryou",
    options?: { muted?: boolean },
  ) => void;
  // Put an explicit track list on air (the Radio page's stations and saved
  // playlists). `preserveOrder` keeps a curated playlist in its saved order.
  playRadio: (
    tracks: PlayerTrack[],
    options?: { key?: string; preserveOrder?: boolean },
  ) => void;
  reshuffleRadio: () => void;
  stopRadio: () => void;
  playQueue: (tracks: PlayerTrack[], startIndex: number) => void;
  togglePlay: () => void;
  // Halt playback without toggling — used when entering a live room so
  // background music never fights the room's own audio.
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const LAST_TRACK_KEY = "melori:lastTrack";
const VOLUME_KEY = "melori:volume";

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}

export default function PlayerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Tracks which track's signed URL is currently loaded into the <audio>.
  // Key of the track whose signed URL is loaded into the <audio>. Uses the
  // composite trackKey() so legacy and studio ids never collide.
  const loadedIdRef = useRef<string | null>(null);
  // Holds the latest auto-advance behavior for the (once-bound) "ended" event.
  const advanceRef = useRef<() => void>(() => {});
  // True while playback is halted by an explicit user pause. Guards against a
  // late "ended" event (e.g. pausing right at the tail) silently auto-advancing.
  const userPausedRef = useRef(false);
  // Free-preview window (absolute seconds in the track timeline) for the loaded
  // track, or null for full access. `sampleLimitRef` is the cap (previewEnd);
  // `sampleStartRef` is where the audible window begins (previewStart).
  const sampleLimitRef = useRef<number | null>(null);
  const sampleStartRef = useRef<number>(0);
  // A one-shot seek target applied once the new src reports its metadata.
  const pendingSeekRef = useRef<number | null>(null);
  // Consecutive unplayable tracks skipped on the radio. Bounded by the queue
  // length so an entirely dead pool surfaces an error instead of spinning.
  const deadSkipsRef = useRef(0);
  const queueLengthRef = useRef(0);

  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  // Mirror `muted` into a ref so loadAndPlay can apply it synchronously before
  // calling audio.play() (state updates lag a render behind).
  const mutedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [sampleEnded, setSampleEnded] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioStationKey, setRadioStationKey] = useState<string | null>(null);
  // Mirror radioMode into a ref so the (stable) auto-advance handler can read
  // the latest value without being torn down/rebound on every toggle.
  const radioModeRef = useRef(false);
  useEffect(() => {
    radioModeRef.current = radioMode;
  }, [radioMode]);
  // Whether the station on air plays in its saved order (playlists) or shuffles.
  const preserveOrderRef = useRef(false);
  useEffect(() => {
    queueLengthRef.current = queue.length;
  }, [queue]);

  // --- single shared <audio> element + event wiring ---
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    const onTime = () => {
      // Hard-cap free previews at the window end: a free listener must not be
      // able to hear past previewEnd even though the audio element holds the
      // full file. Server-side gating serves a dedicated clip when one exists.
      const limit = sampleLimitRef.current;
      if (limit != null && audio.currentTime >= limit) {
        // Clear the cap first so a late tick can't re-enter while we swap src.
        sampleLimitRef.current = null;
        audio.pause();
        audio.currentTime = limit;
        setCurrentTime(limit);
        if (radioModeRef.current) {
          // On the radio a preview ending must not end the station — roll on to
          // the next track. Gating is unchanged: the listener still hears only
          // the preview window of every track.
          advanceRef.current();
        } else {
          userPausedRef.current = true;
          setSampleEnded(true);
        }
        return;
      }
      setCurrentTime(audio.currentTime);
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const onMeta = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
      // Apply a pending window seek (previewStart) now that the new src is ready.
      if (pendingSeekRef.current != null) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (Number.isFinite(target) && target > 0) {
          try {
            audio.currentTime = target;
            setCurrentTime(target);
          } catch {
            /* seek not yet permitted; ignore */
          }
        }
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => advanceRef.current();
    const onError = () => {
      const mediaError = audio.error;
      const code = mediaError?.code;
      // MEDIA_ERR_ABORTED (1) fires whenever we swap `audio.src` to load the
      // next track — that's normal churn, not a playback failure, so ignore it.
      // Surfacing it was showing a spurious "Unable to play this track" while
      // the new track loaded and its progress bar moved.
      if (code === 1 /* MEDIA_ERR_ABORTED */) return;

      let message = "Unable to play this track.";
      if (code === 2 /* MEDIA_ERR_NETWORK */) {
        message = "Network error — check your connection and try again.";
      } else if (code === 3 /* MEDIA_ERR_DECODE */) {
        message = "This track couldn't be decoded.";
      } else if (code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */) {
        message = "This track's audio format isn't supported.";
      }
      console.error(
        `[player] audio error code=${code ?? "?"} src=${audio.currentSrc || "(none)"}: ${
          mediaError?.message ?? "unknown"
        }`,
      );
      setError(message);
      setIsPlaying(false);
      setIsLoading(false);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  // --- restore last track + volume from localStorage (paused; no autoplay) ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawVol = window.localStorage.getItem(VOLUME_KEY);
      if (rawVol != null) {
        const v = Number(rawVol);
        if (Number.isFinite(v)) setVolumeState(Math.max(0, Math.min(1, v)));
      }
      const raw = window.localStorage.getItem(LAST_TRACK_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          current?: PlayerTrack;
          queue?: PlayerTrack[];
          index?: number;
        };
        if (saved?.current) {
          setCurrent(saved.current);
          setQueue(
            saved.queue && saved.queue.length ? saved.queue : [saved.current],
          );
          setIndex(saved.index ?? 0);
          // Intentionally NOT loading/playing — restored paused.
        }
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // --- keep <audio> muted flag in sync ---
  useEffect(() => {
    mutedRef.current = muted;
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // --- keep <audio> volume in sync + persist ---
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VOLUME_KEY, String(volume));
      } catch {
        /* ignore */
      }
    }
  }, [volume]);

  // --- persist last track / queue / index ---
  useEffect(() => {
    if (typeof window === "undefined" || !current) return;
    try {
      // A radio rotation is the whole catalog; persisting it on every track
      // change would bloat (and can blow) the localStorage quota. Remember only
      // what's on air — radio is re-tuned from the pool on the next visit.
      const payload = radioMode
        ? { current, queue: [current], index: 0 }
        : { current, queue, index };
      window.localStorage.setItem(LAST_TRACK_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [current, queue, index, radioMode]);

  const loadAndPlay = useCallback(
    async (track: PlayerTrack, shouldPlay: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      setError(null);
      setIsLoading(true);
      setSampleEnded(false);
      try {
        const res = await fetch(streamUrlFor(track), {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("stream request failed");
        const data: {
          url?: string;
          sample?: boolean;
          sampleSeconds?: number | null;
          previewStart?: number | null;
          previewEnd?: number | null;
        } = await res.json();
        if (!data.url) throw new Error("no stream url");

        // A windowed sample carries an explicit [previewStart, previewEnd]. The
        // cap is previewEnd (absolute seconds); we seek to previewStart on load.
        const start =
          typeof data.previewStart === "number" ? data.previewStart : 0;
        const end =
          typeof data.previewEnd === "number"
            ? data.previewEnd
            : typeof data.sampleSeconds === "number"
              ? start + data.sampleSeconds
              : null;

        sampleStartRef.current = start;
        sampleLimitRef.current = end;
        pendingSeekRef.current = start > 0 ? start : null;
        setIsSample(Boolean(data.sample));

        audio.src = data.url;
        audio.volume = volume;
        audio.muted = mutedRef.current;
        loadedIdRef.current = trackKey(track);
        if (shouldPlay) {
          userPausedRef.current = false;
          await audio.play();
        }
        deadSkipsRef.current = 0;
      } catch (err) {
        // A blocked autoplay (NotAllowedError) is a browser policy decision, not
        // a broken track — the URL loaded fine and playback works once the user
        // interacts. Don't scare listeners with an error in that case.
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "AbortError") {
          setIsPlaying(false);
        } else if (radioModeRef.current) {
          // The radio must not die on one bad track — roll past it, unless the
          // whole rotation turns out to be unplayable.
          loadedIdRef.current = null;
          deadSkipsRef.current += 1;
          if (deadSkipsRef.current > queueLengthRef.current) {
            deadSkipsRef.current = 0;
            setError("No playable tracks right now.");
            setIsPlaying(false);
          } else {
            advanceRef.current();
          }
        } else {
          console.error("[player] loadAndPlay failed:", err);
          setError("Unable to play this track.");
          setIsPlaying(false);
          loadedIdRef.current = null;
        }
      } finally {
        setIsLoading(false);
      }
    },
    [volume],
  );

  const activateIndex = useCallback(
    (q: PlayerTrack[], i: number, shouldPlay: boolean) => {
      const track = q[i];
      if (!track) return;
      setQueue(q);
      setIndex(i);
      setCurrent(track);
      setCurrentTime(0);
      setDuration(0);
      loadedIdRef.current = null;
      if (shouldPlay) void loadAndPlay(track, true);
    },
    [loadAndPlay],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    // Restored or not-yet-loaded track: fetch a fresh signed URL, then play.
    if (loadedIdRef.current !== trackKey(current)) {
      void loadAndPlay(current, true);
      return;
    }
    if (audio.paused) {
      userPausedRef.current = false;
      void audio.play().catch(() => undefined);
    } else {
      userPausedRef.current = true;
      audio.pause();
    }
  }, [current, loadAndPlay]);

  const playQueue = useCallback(
    (tracks: PlayerTrack[], startIndex: number) => {
      const target = tracks[startIndex];
      if (!target) return;
      // A deliberate track/queue selection exits radio mode so we don't
      // reshuffle away from what the user just chose.
      setRadioMode(false);
      radioModeRef.current = false;
      setRadioStationKey(null);
      // Clicking the already-active track toggles play/pause. Compare via
      // trackKey so legacy id=5 and studio id="5" never masquerade as each
      // other on mixed lists.
      const targetKey = trackKey(target);
      if (
        current &&
        trackKey(current) === targetKey &&
        loadedIdRef.current === targetKey
      ) {
        setQueue(tracks);
        setIndex(startIndex);
        togglePlay();
        return;
      }
      activateIndex(tracks, startIndex, true);
    },
    [current, activateIndex, togglePlay],
  );

  // --- Radio mode -----------------------------------------------------------
  // Radio is not a separate engine: it is this player fed a rotation that
  // reshuffles forever. The homepage hero, the bottom/floating bar and the
  // /social/radio page are three views of this one station.

  const playRadio = useCallback(
    (
      tracks: PlayerTrack[],
      options: { key?: string; preserveOrder?: boolean } = {},
    ) => {
      if (!tracks.length) return;
      const { key = null, preserveOrder = false } = options;
      preserveOrderRef.current = preserveOrder;
      setRadioMode(true);
      radioModeRef.current = true;
      setRadioStationKey(key);
      activateIndex(buildRotation(tracks, preserveOrder), 0, true);
    },
    [activateIndex],
  );

  const startRadio = useCallback(
    async (
      mode: "all" | "foryou" = "all",
      options: { muted?: boolean } = {},
    ) => {
      // Muted starts (homepage autoplay) must set the flag BEFORE the async
      // load so audio.play() is autoplay-eligible when it finally runs.
      if (options.muted) {
        mutedRef.current = true;
        if (audioRef.current) audioRef.current.muted = true;
        setMutedState(true);
      }
      setRadioLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/radio/pool?mode=${mode}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("pool request failed");
        const data: { tracks?: PlayerTrack[] } = await res.json();
        const pool = (data.tracks ?? []).map<PlayerTrack>((t) => ({
          ...t,
          sourceType: t.sourceType ?? "legacy",
        }));
        if (!pool.length) {
          setError("No tracks available for radio right now.");
          return;
        }
        playRadio(pool, { key: mode });
      } catch {
        setError("Couldn't start radio.");
      } finally {
        setRadioLoading(false);
      }
    },
    [playRadio],
  );

  const reshuffleRadio = useCallback(() => {
    if (!queue.length) return;
    activateIndex(buildRotation(queue, preserveOrderRef.current), 0, true);
  }, [queue, activateIndex]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const stopRadio = useCallback(() => {
    setRadioMode(false);
    radioModeRef.current = false;
    setRadioStationKey(null);
    const audio = audioRef.current;
    if (audio) {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const next = useCallback(() => {
    if (index + 1 < queue.length) activateIndex(queue, index + 1, true);
    else if (radioModeRef.current && queue.length)
      activateIndex(buildRotation(queue, preserveOrderRef.current), 0, true);
  }, [index, queue, activateIndex]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
  }, []);

  const prev = useCallback(() => {
    // Restart current if more than 3s in or already at the first track.
    const audio = audioRef.current;
    if (index <= 0 || (audio && audio.currentTime > 3)) {
      seek(0);
      return;
    }
    activateIndex(queue, index - 1, true);
  }, [index, queue, activateIndex, seek]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    if (audioRef.current) audioRef.current.muted = m;
    setMutedState(m);
  }, []);

  // Keep the "ended" auto-advance handler pointing at the latest queue/index.
  useEffect(() => {
    advanceRef.current = () => {
      // A user-initiated pause must never be overridden by auto-advance.
      if (userPausedRef.current) return;
      if (index + 1 < queue.length) {
        activateIndex(queue, index + 1, true);
      } else if (radioModeRef.current && queue.length) {
        // Radio mode never ends: rebuild the rotation and keep going.
        activateIndex(buildRotation(queue, preserveOrderRef.current), 0, true);
      } else {
        // Last track finished: stop cleanly but keep it shown, paused at its
        // end. Do NOT reset progress or clear `current` (no placeholder wipe).
        setIsPlaying(false);
      }
    };
  }, [index, queue, activateIndex]);

  // --- OS media session -----------------------------------------------------
  // Publishes the playing track to the OS so Bluetooth head units (AVRCP),
  // CarPlay, Android Auto and lock screens show real title/artist/artwork and
  // their hardware buttons drive this player instead of showing "Unknown".
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    if (!current) {
      try {
        ms.metadata = null;
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: current.title || "MELORI MUSIC",
        artist: current.artistName || "MELORI MUSIC",
        album: current.album || "MELORI MUSIC",
        artwork: current.coverUrl
          ? [
              // Same URL at several advertised sizes — head units pick what
              // fits. The sizes hint is a preference signal, not a promise.
              { src: current.coverUrl, sizes: "96x96", type: "image/jpeg" },
              { src: current.coverUrl, sizes: "256x256", type: "image/jpeg" },
              { src: current.coverUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      /* older browsers may throw constructing MediaMetadata; ignore */
    }
  }, [current]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying
        ? "playing"
        : current
          ? "paused"
          : "none";
    } catch {
      /* ignore */
    }
  }, [isPlaying, current]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {
      /* some browsers reject stale states — ignore */
    }
  }, [currentTime, duration]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported on this browser — ignore */
      }
    };
    setHandler("play", () => {
      if (!isPlaying) togglePlay();
    });
    setHandler("pause", () => {
      if (isPlaying) togglePlay();
    });
    setHandler("nexttrack", () => next());
    setHandler("previoustrack", () => prev());
    // Some head units send stop instead of pause when audio is cut.
    setHandler("stop", () => {
      if (isPlaying) pause();
    });
    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("nexttrack", null);
      setHandler("previoustrack", null);
      setHandler("stop", null);
    };
  }, [isPlaying, togglePlay, next, prev, pause]);

  return (
    <PlayerContext.Provider
      value={{
        current,
        queue,
        index,
        isPlaying,
        isLoading,
        currentTime,
        duration,
        volume,
        muted,
        error,
        isSample,
        sampleEnded,
        radioMode,
        radioLoading,
        radioStationKey,
        startRadio,
        playRadio,
        reshuffleRadio,
        stopRadio,
        hasNext: index + 1 < queue.length,
        hasPrev: queue.length > 1 && index > 0,
        playQueue,
        togglePlay,
        pause,
        next,
        prev,
        seek,
        setVolume,
        setMuted,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
