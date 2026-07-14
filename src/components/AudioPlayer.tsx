"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";

// Small chevron used by the collapse/expand toggle.
function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 transition-transform ${up ? "" : "rotate-180"}`}
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function PlayPauseIcon({ playing }: { playing: boolean }) {
  if (playing) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M7 6h2v12H7zM20 6v12l-9-6z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M15 6h2v12h-2zM4 6v12l9-6z" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  );
}

export default function AudioPlayer() {
  const {
    current,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    error,
    isSample,
    sampleEnded,
    hasNext,
    hasPrev,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
  } = usePlayer();

  const fraction = duration > 0 ? currentTime / duration : 0;

  // Melori Radio runs its own dual-deck player, so the global bar would be a
  // confusing second set of controls there. Hide it on that route.
  const pathname = usePathname();
  const onRadio = pathname?.startsWith("/social/radio");

  // Collapsed state — lets the user tuck the bar away so it never blocks the
  // mobile nav. Playback keeps running; only the UI shrinks to a peek strip.
  // Persisted so the choice survives navigation/reloads.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("melori:player:collapsed") === "1");
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("melori:player:collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  // On the Radio route the page owns playback — don't render a second player.
  if (onRadio) return null;

  // Collapsed: a slim, dismissible peek strip. overflow-hidden guarantees it can
  // never push the layout sideways and cover the nav buttons.
  if (collapsed) {
    return (
      <div className="fixed bottom-14 md:bottom-0 inset-x-0 z-50 overflow-hidden border-t border-brand-border bg-brand-surface/95 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-3 sm:px-6 py-1.5">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!current}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
          >
            <PlayPauseIcon playing={isPlaying} />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
            {current ? current.title : "Nothing playing"}
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand player"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
          >
            <Chevron up />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-14 md:bottom-0 inset-x-0 z-50 overflow-hidden border-t border-brand-border bg-brand-surface/95 backdrop-blur">
      {/* Free-preview upgrade prompt — shown when a 30s sample ends. */}
      {current && sampleEnded && (
        <div className="border-b border-brand-border bg-brand-primary/10 px-3 sm:px-6 py-2">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-text-secondary">
              You&apos;re hearing a 30-second preview. Become a Superfan to play
              full songs.
            </span>
            <Link
              href="/membership"
              className="shrink-0 rounded-full bg-brand-primary px-4 py-1.5 font-semibold text-black transition-opacity hover:opacity-90"
            >
              Upgrade — $2.99/mo
            </Link>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex flex-col gap-1.5">
        {/* Top row: track info + controls */}
        <div className="flex items-center gap-3">
          {/* Track info */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {current ? (
              <>
                <CoverImage
                  src={current.coverUrl}
                  alt={current.title}
                  className="h-11 w-11 shrink-0"
                  rounded="rounded"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-text-primary">
                    <span className="truncate">{current.title}</span>
                    {isSample && (
                      <span className="shrink-0 rounded-full bg-brand-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-primary">
                        Preview
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-text-secondary">
                    {error ?? current.artistName ?? "MELORI MUSIC"}
                  </p>
                </div>
              </>
            ) : (
              <span className="text-sm text-text-secondary">
                Select a track to start listening
              </span>
            )}
          </div>

          {/* Transport controls */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={!current || !hasPrev}
              aria-label="Previous track"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <PrevIcon />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={!current}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
            >
              {isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <PlayPauseIcon playing={isPlaying} />
              )}
            </button>

            <button
              type="button"
              onClick={next}
              disabled={!current || !hasNext}
              aria-label="Next track"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <NextIcon />
            </button>

            {/* Volume — hidden on very small screens */}
            <div className="ml-1 hidden items-center gap-2 sm:flex">
              <span className="text-text-secondary">
                <VolumeIcon />
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-brand-muted"
                style={{ accentColor: "#ff5500" }}
              />
            </div>

            {/* Collapse toggle — tucks the bar into a slim peek strip so it
                never blocks the mobile navigation. */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Hide player"
              title="Hide player"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
            >
              <Chevron up={false} />
            </button>
          </div>
        </div>

        {/* Bottom row: seekable progress bar with times */}
        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
            {formatTime(currentTime)}
          </span>
          <button
            type="button"
            aria-label="Seek"
            disabled={!current || duration <= 0}
            onClick={(e) => {
              if (!current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}
            className="group relative h-3 flex-1 cursor-pointer"
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand-muted" />
            <span
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand-primary"
              style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
            />
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-primary opacity-0 transition-opacity group-hover:opacity-100"
              style={{ left: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
            />
          </button>
          <span className="w-9 shrink-0 text-[11px] tabular-nums text-text-secondary">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
