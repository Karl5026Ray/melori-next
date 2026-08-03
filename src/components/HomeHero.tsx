"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CoverImage from "@/components/CoverImage";
import PlayCount from "@/components/PlayCount";
import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";

// The homepage "instant listening" hero. On load it tunes the SHARED player
// (same <audio> element and context as the persistent bottom bar, the floating
// mobile player and the Radio page) into the radio station MUTED — the only
// form of autoplay browsers permit — then unmutes on the visitor's first
// interaction anywhere on the page, TikTok-style. Because it's the radio and
// not a one-track queue, playback rolls on through the catalog instead of
// stopping after the first song.
export default function HomeHero({ track }: { track: PlayerTrack }) {
  const {
    current,
    isPlaying,
    isLoading,
    muted,
    currentTime,
    duration,
    error,
    radioMode,
    playAudible,
    pause,
    setMuted,
    startRadio,
  } = usePlayer();

  // Guard so we only kick off autoplay once, and only auto-unmute once.
  const startedRef = useRef(false);
  const unmutedRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // What the hero shows: whatever the one shared player has on air, falling
  // back to the server-rendered featured track until the station is tuned.
  const shown = current ?? track;

  // Play baseline for whatever is on air, keyed by legacy track id. Radio pool
  // rows carry their own total, so the count follows the station from song to
  // song; studio uploads have none and contribute an empty map.
  const playBaseline = useMemo(() => {
    const id = Number(shown.id);
    if (shown.sourceType === "studio" || !Number.isInteger(id)) return {};
    return { [id]: shown.playCount ?? 0 };
  }, [shown.id, shown.sourceType, shown.playCount]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Tune into the radio once on mount — but never interrupt audio that is
  // already going. Navigating back to the homepage mid-song must not restart
  // or double-start anything.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (isPlaying || radioMode) return;
    startRadio("all", { muted: true });
    // Intentionally mount-only: `isPlaying` / `radioMode` are read once as the
    // "is something already on air?" snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmute — and, on browsers that blocked the muted autoplay, actually START
  // playback — on the visitor's FIRST interaction anywhere on the page.
  //
  // `playAudible()` is called unconditionally and does the whole sequence in the
  // right order (unlock inside this gesture → real signed src → unmute → play).
  // It replaces an `unlockPlayback() + setMuted(false) + if (!isPlaying)
  // togglePlay()` chain whose `isPlaying` test could skip the reload and leave
  // the silent unlock clip as the audio source, so the hero showed "unmuted"
  // while nothing audible ever played.
  useEffect(() => {
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    const onFirstInteraction = (e: Event) => {
      if (unmutedRef.current) return;
      unmutedRef.current = true;
      // A tap on one of the hero's own controls is handled by that control's
      // onClick. Acting here too would run against the pre-tap render's state
      // while the click runs against the post-tap one, so the two could disagree
      // (start here, then immediately pause there).
      const el = e.target as HTMLElement | null;
      if (!el?.closest("[data-hero-audio-control]")) playAudible();
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
  }, [playAudible]);

  const fraction = duration > 0 ? currentTime / duration : 0;
  const showSoundPrompt = muted && !error;
  const animate = isPlaying && !reducedMotion && !muted;

  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      <div className="relative flex flex-col items-center gap-5 rounded-3xl border border-brand-border bg-brand-surface/70 p-6 backdrop-blur sm:flex-row sm:items-center sm:gap-6 sm:p-7">
        {/* Cover art */}
        <div className="relative shrink-0">
          <CoverImage
            src={shown.coverUrl}
            alt={shown.title}
            className="h-40 w-40 shadow-2xl sm:h-44 sm:w-44"
            rounded="rounded-2xl"
          />
          <button
            type="button"
            data-hero-audio-control
            onClick={() => {
              unmutedRef.current = true;
              // While still muted this is "give me sound", not a pause control —
              // the visitor has not heard anything yet.
              if (isPlaying && !muted) pause();
              else playAudible();
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
            {isPlaying ? (radioMode ? "Melori Radio" : "Now playing") : "Featured"}
          </span>
          <h2 className="mt-1 max-w-full truncate text-2xl font-bold text-text-primary">
            {shown.title}
          </h2>
          {/* The count shares the artist's existing line so it can appear
              mid-listen without nudging the layout. */}
          <p className="mt-0.5 flex max-w-full items-center justify-center gap-2 text-sm text-text-secondary sm:justify-start">
            <span className="min-w-0 truncate">
              {shown.artistName ?? "MELORI MUSIC"}
            </span>
            <PlayCount baseline={playBaseline} />
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
              playAudible();
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
        {!muted && !error && (
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
