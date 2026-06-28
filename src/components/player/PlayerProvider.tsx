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
  isPlaying: boolean;
  isLoading: boolean;
  progress: number; // 0..1
  duration: number; // seconds
  error: string | null;
  playTrack: (track: PlayerTrack) => void;
  togglePlay: () => void;
  seek: (fraction: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

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
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Lazily create the single shared <audio> element.
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    const onTime = () => {
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
        setDuration(audio.duration);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };
    const onError = () => {
      setError("Unable to play this track.");
      setIsPlaying(false);
      setIsLoading(false);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  const playTrack = useCallback(
    async (track: PlayerTrack) => {
      const audio = audioRef.current;
      if (!audio) return;

      // Toggle if the same track is selected again.
      if (current?.id === track.id) {
        if (audio.paused) {
          void audio.play().catch(() => undefined);
        } else {
          audio.pause();
        }
        return;
      }

      setError(null);
      setCurrent(track);
      setProgress(0);
      setDuration(0);
      setIsLoading(true);

      try {
        const res = await fetch(`/api/tracks/${track.id}/stream`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("stream request failed");
        const data: { url?: string } = await res.json();
        if (!data.url) throw new Error("no stream url");

        audio.src = data.url;
        await audio.play();
      } catch {
        setError("Unable to play this track.");
        setIsPlaying(false);
      } finally {
        setIsLoading(false);
      }
    },
    [current],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [current]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        current,
        isPlaying,
        isLoading,
        progress,
        duration,
        error,
        playTrack,
        togglePlay,
        seek,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
