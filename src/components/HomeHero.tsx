"use client";

import { useEffect, useRef, useState } from "react";
import CoverImage from "@/components/CoverImage";
import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";

// The homepage "instant listening" hero. On load it drives the SHARED player
// (same <audio> element and context as the persistent bottom bar) to autoplay a
// real catalog track MUTED — the only form of autoplay browsers permit — then
// unmutes on the visitor's first interaction anywhere on the page, TikTok-style.
export default function HomeHero({ track }: { track: PlayerTrack }) {
  const {
    current,
    isPlaying,
    isLoading,
    muted,
    currentTime,
    duration,
    error,
    togglePlay,
    setMuted,
    playMutedAutoplay,
    unlockPlayback,
  } = usePlayer();

  // Guard so we only kick off autoplay once, and only auto-unmute once.
  const startedRef = useRef(false);
  const unmutedRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Mirror isPlaying so the (window) first-interaction handler reads the live
  // value without being re-bound on every play/pause.
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const isThisTrack =
    current?.sourceType === track.sourceType && current?.id === track.id;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Kick off muted autoplay once on mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    playMutedAutoplay(track);
  }, [track, playMutedAutoplay]);

  // Unmute — and, on browsers that blocked the muted autoplay (iOS), actually
  // START playback — on the visitor's FIRST interaction anywhere on the page.
  useEffect(() => {
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    const onFirstInteraction = (e: Event) => {
      if (unmutedRef.current) return;
      unmutedRef.current = true;
      // Bless the shared <audio> element inside this real gesture so a
      // (re)start of the track is permitted even on strict autoplay policies.
      unlockPlayback();
      setMuted(false);
      // If the tap landed on one of the hero's own audio controls, that
      // control handles playback itself — don't double-trigger it here.
      const el = e.target as HTMLElement | null;
      const onControl = Boolean(el && el.closest("[data-hero-audio-control]"));
      if (!onControl && !isPlayingRef.current) {
        // Muted autoplay was blocked; kick real (now-unmuted) playback off.
        togglePlay();
      }
      cleanup();
    };
    const cleanup = () => {
      for (const evt of events) {
        window.removeEventListener(evt, onFirstInteraction);
      }
    };
    for (const evt of events) {
      window.addEventListener(evt, onFirstInteraction, {
        once: false,
        passive: true,
      });
    }
    return cleanup;
  }, [setMuted, unlockPlayback, togglePlay]);

  const fraction = duration > 0 ? currentTime / duration : 0;
  const showSoundPrompt = isThisTrack && muted && !error;
  const animate = isPlaying && !reducedMotion && !muted;

  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      <div className="relative flex flex-col items-center gap-5 rounded-3xl border border-brand-border bg-brand-surface/70 p-6 backdrop-blur sm:flex-row sm:items-center sm:gap-6 sm:p-7">
        {/* Cover art */}
        <div className="relative shrink-0">
          <CoverImage
            src={track.coverUrl}
            alt={track.title}
            className="h-40 w-40 shadow-2xl sm:h-44 sm:w-44"
            rounded="rounded-2xl"
          />
          <button
            type="button"
            data-hero-audio-control
            onClick={() => {
              unmutedRef.current = true;
              unlockPlayback();
              setMuted(false);
              togglePlay();
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
          >
            {isLoading ? (
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-12 w-12">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-12 w-12">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>

        {/* Now-playing details */}
        <div className="flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:text-left">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand-primary">
            {isPlaying ? "Now playing" : "Featured"}
          </span>
          <h2 className="mt-1 max-w-full truncate text-2xl font-bold text-text-primary">
            {track.title}
          </h2>
          <p className="mt-0.5 truncate text-sm text-text-secondary">
            {track.artistName ?? "MELORI MUSIC"}
          </p>

          {/* Waveform visualization */}
          <div
            className="mt-4 flex h-10 w-full items-end justify-center gap-1 sm:justify-start"
            aria-hidden
          >
            {WAVE_BARS.map((base, i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-brand-primary/80"
                style={
                  animate
                    ? {
                        height: `${base}%`,
                        transformOrigin: "bottom",
                        animation: `meloriWave 1.1s ease-in-out ${i * 0.07}s infinite`,
                      }
                    : { height: `${Math.max(18, base * 0.5)}%` }
                }
              />
            ))}
          </div>

          {/* Progress */}
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-brand-muted">
            <div
              className="h-full rounded-full bg-brand-primary transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
            />
          </div>

          {error && (
            <p className="mt-2 text-xs text-text-secondary">{error}</p>
          )}
        </div>

        {/* Tap-to-unmute affordance — prominent, TikTok-style. */}
        {showSoundPrompt && (
          <button
            type="button"
            data-hero-audio-control
            onClick={() => {
              unmutedRef.current = true;
              unlockPlayback();
              setMuted(false);
              // Start playback if the muted autoplay was blocked (iOS).
              if (!isPlaying) togglePlay();
            }}
            className="absolute -top-3 right-4 flex items-center gap-2 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 sm:-top-3 sm:right-6"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M5 9v6h4l5 5V4L9 9H5z" />
              <path
                d="M17 8l4 8M21 8l-4 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            Tap for sound
          </button>
        )}
        {isThisTrack && !muted && !error && (
          <button
            type="button"
            onClick={() => setMuted(true)}
            aria-label="Mute"
            className="absolute -top-3 right-4 flex h-9 w-9 items-center justify-center rounded-full border border-brand-border bg-brand-surface text-text-secondary shadow transition-colors hover:text-brand-primary sm:right-6"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M5 9v6h4l5 5V4L9 9H5z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// Base bar heights (percent) — an organic, non-uniform silhouette so the
// waveform reads as a real visualization rather than an even equalizer.
const WAVE_BARS = [
  40, 65, 85, 55, 95, 70, 45, 80, 60, 100, 50, 75, 35, 90, 55, 70, 45, 85, 60,
  40,
];
