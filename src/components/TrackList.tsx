"use client";

import { useMemo } from "react";
import BuyButton from "@/components/BuyButton";
import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";
import { formatDuration } from "@/lib/format";
import type { Track } from "@/types";

const DEFAULT_TRACK_PRICE = 0.99;

interface TrackListProps {
  tracks: Track[];
  artistName: string | null;
  coverUrl: string | null;
}

export default function TrackList({
  tracks,
  artistName,
  coverUrl,
}: TrackListProps) {
  const { current, isPlaying, playQueue } = usePlayer();

  // The whole album becomes the player queue; clicking a row starts there.
  const queue = useMemo<PlayerTrack[]>(
    () =>
      tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artistName,
        coverUrl,
      })),
    [tracks, artistName, coverUrl],
  );

  if (tracks.length === 0) {
    return <p className="text-text-secondary">No tracks available yet.</p>;
  }

  return (
    <ul className="divide-y divide-brand-border rounded-lg border border-brand-border bg-brand-surface">
      {tracks.map((track, index) => {
        const isCurrent = current?.id === track.id;
        const showPause = isCurrent && isPlaying;
        const isPlayable = Boolean(track.audio_url || track.preview_url);
        return (
          <li
            key={track.id}
            className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-brand-muted"
          >
            <button
              type="button"
              onClick={() => playQueue(queue, index)}
              disabled={!isPlayable}
              aria-label={
                !isPlayable
                  ? `${track.title} (no preview available)`
                  : showPause
                    ? `Pause ${track.title}`
                    : `Play ${track.title}`
              }
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-border text-text-secondary transition-colors hover:border-brand-primary hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-brand-border disabled:hover:text-text-secondary"
            >
              {showPause ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <span className="w-6 shrink-0 text-sm text-text-secondary">
              {track.track_number ?? index + 1}
            </span>

            <span
              className={`min-w-0 flex-1 truncate ${
                isCurrent ? "text-brand-primary" : "text-text-primary"
              }`}
            >
              {track.title}
            </span>

            <span className="shrink-0 text-sm text-text-secondary">
              {formatDuration(track.duration_seconds)}
            </span>

            {track.vps_track_id != null && (
              <BuyButton
                vpsTrackId={track.vps_track_id}
                price={track.price ?? DEFAULT_TRACK_PRICE}
                title={track.title}
                variant="compact"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
