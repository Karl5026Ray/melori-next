"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipForward,
  Shuffle,
  Volume2,
  VolumeX,
  Radio as RadioIcon,
  Sparkles,
  Music2,
  Loader2,
} from "lucide-react";
import { authHeaders } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useRadioMixer } from "@/components/radio/useRadioMixer";
import type { RadioTrack } from "@/lib/data";

type Mode = "foryou" | "all";

function fmt(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function RadioClient() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("all");
  const [pool, setPool] = useState<RadioTrack[]>([]);
  const [personalized, setPersonalized] = useState(false);
  const [loadingPool, setLoadingPool] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  // Preserve tuned/playing state across a mode switch so switching stations
  // doesn't force the listener to press Tune In again.
  const wasTunedRef = useRef(false);

  const { state, tuneIn, togglePlay, skip, reshuffle, setVolume } =
    useRadioMixer(pool);

  // Load the pool for the current mode.
  const loadPool = useCallback(async (m: Mode) => {
    setLoadingPool(true);
    setPoolError(null);
    try {
      const res = await fetch(`/api/radio/pool?mode=${m}`, {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("pool request failed");
      const data: {
        tracks: RadioTrack[];
        personalized: boolean;
      } = await res.json();
      setPool(data.tracks ?? []);
      setPersonalized(Boolean(data.personalized));
    } catch {
      setPoolError("Couldn't load the radio right now. Try again.");
      setPool([]);
    } finally {
      setLoadingPool(false);
    }
  }, []);

  useEffect(() => {
    void loadPool(mode);
  }, [mode, loadPool]);

  // Remember tuned state so we can auto-resume after a station swap.
  useEffect(() => {
    if (state.tuned) wasTunedRef.current = true;
  }, [state.tuned]);

  // After the pool for a new mode is ready, resume playing if we were tuned.
  useEffect(() => {
    if (!loadingPool && wasTunedRef.current && state.ready && !state.tuned) {
      void tuneIn();
    }
  }, [loadingPool, state.ready, state.tuned, tuneIn]);

  const { current, next, isPlaying, isLoading, currentTime, duration, volume } =
    state;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-40 md:pb-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-accent text-white">
          <RadioIcon className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Melori Radio</h1>
          <p className="text-sm text-text-secondary">
            Every track, non-stop, mixed for you.
          </p>
        </div>
      </div>

      {/* Station toggle */}
      <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-brand-border bg-white/[0.03] p-1">
        <button
          onClick={() => setMode("foryou")}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
            mode === "foryou"
              ? "bg-brand-primary text-white"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          For You
        </button>
        <button
          onClick={() => setMode("all")}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
            mode === "all"
              ? "bg-brand-primary text-white"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Music2 className="h-4 w-4" />
          All Tracks
        </button>
      </div>

      {/* For You hint when we couldn't personalize */}
      {mode === "foryou" && !loadingPool && !personalized && (
        <div className="mb-5 rounded-xl border border-brand-border bg-white/[0.03] p-3 text-sm text-text-secondary">
          {user ? (
            <>
              Follow some artists and play a few tracks — your For You station
              tunes itself to your taste. For now it&apos;s playing the full
              catalog.
            </>
          ) : (
            <>
              <Link href="/social/auth" className="text-brand-primary underline">
                Sign in
              </Link>{" "}
              to get a station personalized to the artists you follow. For now
              it&apos;s playing the full catalog.
            </>
          )}
        </div>
      )}

      {/* Now playing card */}
      <div className="rounded-3xl border border-brand-border bg-brand-surface p-5">
        {loadingPool ? (
          <div className="flex h-64 items-center justify-center text-text-secondary">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : poolError ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-text-secondary">{poolError}</p>
            <button
              onClick={() => loadPool(mode)}
              className="rounded-full border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary hover:text-white"
            >
              Retry
            </button>
          </div>
        ) : pool.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-center text-sm text-text-secondary">
            No published tracks are available yet.
          </div>
        ) : (
          <>
            {/* Cover */}
            <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-brand-muted">
              {current?.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.coverUrl}
                  alt={current.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-brand-primary">
                  <Music2 className="h-16 w-16" />
                </div>
              )}
              {state.tuned && isPlaying && (
                <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" />
                  ON AIR
                </span>
              )}
            </div>

            {/* Track meta */}
            <div className="mt-5 text-center">
              <p className="truncate text-lg font-bold text-text-primary">
                {current?.title ?? "—"}
              </p>
              <p className="truncate text-sm text-text-secondary">
                {current?.artistName ?? "Unknown artist"}
                {current?.album ? ` · ${current.album}` : ""}
              </p>
              {state.isSample && (
                <p className="mt-1 text-xs text-brand-primary">
                  Preview · {" "}
                  <Link href="/membership" className="underline">
                    upgrade for full tracks
                  </Link>
                </p>
              )}
            </div>

            {/* Progress */}
            <div className="mt-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-muted">
                <div
                  className="h-full rounded-full bg-brand-primary transition-[width] duration-200"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-text-secondary">
                <span>{fmt(currentTime)}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-5 flex items-center justify-center gap-6">
              <button
                onClick={reshuffle}
                aria-label="Reshuffle"
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
              >
                <Shuffle className="h-5 w-5" />
              </button>

              <button
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-primary text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                {isLoading ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-7 w-7" />
                ) : (
                  <Play className="ml-0.5 h-7 w-7" />
                )}
              </button>

              <button
                onClick={skip}
                aria-label="Skip"
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

            {/* Volume */}
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={() => setVolume(volume > 0 ? 0 : 1)}
                aria-label={volume > 0 ? "Mute" : "Unmute"}
                className="text-text-secondary hover:text-brand-primary"
              >
                {volume > 0 ? (
                  <Volume2 className="h-5 w-5" />
                ) : (
                  <VolumeX className="h-5 w-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 flex-1 cursor-pointer accent-brand-primary"
              />
            </div>

            {/* Up next */}
            {next && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-brand-border bg-white/[0.03] p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  Next
                </span>
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-brand-muted">
                  {next.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={next.coverUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-brand-primary">
                      <Music2 className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {next.title}
                  </p>
                  <p className="truncate text-xs text-text-secondary">
                    {next.artistName ?? "Unknown artist"}
                  </p>
                </div>
              </div>
            )}

            {/* Tune In (first play) */}
            {!state.tuned && (
              <button
                onClick={tuneIn}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
              >
                <Play className="h-4 w-4" />
                Tune In
              </button>
            )}

            <p className="mt-4 text-center text-[11px] text-text-secondary">
              {state.queueLength} tracks in rotation · crossfaded, non-stop
            </p>
          </>
        )}
      </div>
    </div>
  );
}
