"use client";

import CoverImage from "@/components/CoverImage";
import { usePlayer } from "@/components/player/PlayerProvider";

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

export default function AudioPlayer() {
  const { current, isPlaying, isLoading, progress, error, togglePlay, seek } =
    usePlayer();

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-brand-border bg-brand-surface/95 backdrop-blur">
      {/* Progress bar */}
      <div
        className="h-1 w-full bg-brand-muted cursor-pointer"
        onClick={(e) => {
          if (!current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - rect.left) / rect.width);
        }}
      >
        <div
          className="h-full bg-brand-primary transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="max-w-6xl mx-auto h-16 px-4 sm:px-6 flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!current}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
        >
          {isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <PlayPauseIcon playing={isPlaying} />
          )}
        </button>

        {current ? (
          <div className="flex min-w-0 items-center gap-3">
            <CoverImage
              src={current.coverUrl}
              alt={current.title}
              className="h-10 w-10 shrink-0"
              rounded="rounded"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">
                {current.title}
              </p>
              <p className="truncate text-xs text-text-secondary">
                {error ?? current.artistName ?? "MELORI MUSIC"}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-sm text-text-secondary">
            Select a track to start listening
          </span>
        )}
      </div>
    </div>
  );
}
