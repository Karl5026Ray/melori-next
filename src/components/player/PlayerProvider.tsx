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

interface PlayerContextValue {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number; // seconds
  duration: number; // seconds
  volume: number; // 0..1
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
  startRadio: (mode?: "all" | "foryou") => void;
  stopRadio: () => void;
  playQueue: (tracks: PlayerTrack[], startIndex: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  setVolume: (v: number) => void;
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

  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [sampleEnded, setSampleEnded] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [radioLoading, setRadioLoading] = useState(false);
  // Mirror radioMode into a ref so the (stable) auto-advance handler can read
  // the latest value without being torn down/rebound on every toggle.
  const radioModeRef = useRef(false);
  useEffect(() => {
    radioModeRef.current = radioMode;
  }, [radioMode]);

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
        userPausedRef.current = true;
        audio.pause();
        audio.currentTime = limit;
        setCurrentTime(limit);
        setSampleEnded(true);
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
      setError("Unable to play this track.");
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
      window.localStorage.setItem(
        LAST_TRACK_KEY,
        JSON.stringify({ current, queue, index }),
      );
    } catch {
      /* ignore */
    }
  }, [current, queue, index]);

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
        loadedIdRef.current = trackKey(track);
        if (shouldPlay) {
          userPausedRef.current = false;
          await audio.play();
        }
      } catch {
        setError("Unable to play this track.");
        setIsPlaying(false);
        loadedIdRef.current = null;
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
  // Fisher–Yates shuffle (no adjacent-artist repair here; the bar is a simple
  // sequential player — good enough for a "turn radio on" toggle).
  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const startRadio = useCallback(
    async (mode: "all" | "foryou" = "all") => {
      setRadioLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/radio/pool?mode=${mode}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("pool request failed");
        const data: {
          tracks?: Array<{
            id: number | string;
            sourceType?: TrackSource;
            title: string;
            artistName: string | null;
            coverUrl: string | null;
          }>;
        } = await res.json();
        const pool = (data.tracks ?? []).map<PlayerTrack>((t) => ({
          id: t.id,
          title: t.title,
          artistName: t.artistName,
          coverUrl: t.coverUrl,
          sourceType: t.sourceType ?? "legacy",
        }));
        if (!pool.length) {
          setError("No tracks available for radio right now.");
          return;
        }
        setRadioMode(true);
        radioModeRef.current = true;
        activateIndex(shuffle(pool), 0, true);
      } catch {
        setError("Couldn't start radio.");
      } finally {
        setRadioLoading(false);
      }
    },
    [activateIndex],
  );

  const stopRadio = useCallback(() => {
    setRadioMode(false);
    radioModeRef.current = false;
    const audio = audioRef.current;
    if (audio) {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const next = useCallback(() => {
    if (index + 1 < queue.length) activateIndex(queue, index + 1, true);
    else if (radioModeRef.current && queue.length)
      activateIndex(shuffle(queue), 0, true);
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

  // Keep the "ended" auto-advance handler pointing at the latest queue/index.
  useEffect(() => {
    advanceRef.current = () => {
      // A user-initiated pause must never be overridden by auto-advance.
      if (userPausedRef.current) return;
      if (index + 1 < queue.length) {
        activateIndex(queue, index + 1, true);
      } else if (radioModeRef.current && queue.length) {
        // Radio mode never ends: reshuffle the whole catalog and keep going.
        activateIndex(shuffle(queue), 0, true);
      } else {
        // Last track finished: stop cleanly but keep it shown, paused at its
        // end. Do NOT reset progress or clear `current` (no placeholder wipe).
        setIsPlaying(false);
      }
    };
  }, [index, queue, activateIndex]);

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
        error,
        isSample,
        sampleEnded,
        radioMode,
        radioLoading,
        startRadio,
        stopRadio,
        hasNext: index + 1 < queue.length,
        hasPrev: queue.length > 1 && index > 0,
        playQueue,
        togglePlay,
        next,
        prev,
        seek,
        setVolume,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
