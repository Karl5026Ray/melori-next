"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface PlayerTrack {
  id: number;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
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
  const loadedIdRef = useRef<number | null>(null);
  // Holds the latest auto-advance behavior for the (once-bound) "ended" event.
  const advanceRef = useRef<() => void>(() => {});
  // True while playback is halted by an explicit user pause. Guards against a
  // late "ended" event (e.g. pausing right at the tail) silently auto-advancing.
  const userPausedRef = useRef(false);

  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // --- single shared <audio> element + event wiring ---
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const onMeta = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
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
      try {
        const res = await fetch(`/api/tracks/${track.id}/stream`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("stream request failed");
        const data: { url?: string } = await res.json();
        if (!data.url) throw new Error("no stream url");

        audio.src = data.url;
        audio.volume = volume;
        loadedIdRef.current = track.id;
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
    if (loadedIdRef.current !== current.id) {
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
      // Clicking the already-active track toggles play/pause.
      if (current?.id === target.id && loadedIdRef.current === target.id) {
        setQueue(tracks);
        setIndex(startIndex);
        togglePlay();
        return;
      }
      activateIndex(tracks, startIndex, true);
    },
    [current, activateIndex, togglePlay],
  );

  const next = useCallback(() => {
    if (index + 1 < queue.length) activateIndex(queue, index + 1, true);
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
