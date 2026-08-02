"use client";

import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";
import BuyButton from "@/components/BuyButton";
import { formatDuration, formatPriceCents } from "@/lib/format";

interface AlbumTrack {
  id: string;
  title: string;
  duration: number | null;
  coverUrl: string | null;
  priceCents: number | null;
}

// Track list for a studio album. Clicking any row plays the whole album from
// that point through the shared PlayerProvider, so listens are logged and the
// preview/superfan gating applies exactly as everywhere else on the site.
export default function StudioAlbumTracks({
  tracks,
  artistName,
}: {
  tracks: AlbumTrack[];
  artistName: string;
}) {
  const { current, isPlaying, playQueue } = usePlayer();

  const queue: PlayerTrack[] = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artistName,
    coverUrl: t.coverUrl,
    sourceType: "studio",
  }));

  return (
    <ol className="divide-y divide-brand-border rounded-lg border border-brand-border">
      {tracks.map((track, index) => {
        const isActive =
          current?.sourceType === "studio" && current?.id === track.id;
        const duration = formatDuration(track.duration);
        return (
          <li
            key={track.id}
            className="flex items-center gap-3 px-4 py-3 text-sm"
          >
            <button
              type="button"
              onClick={() => playQueue(queue, index)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              aria-label={`Play ${track.title}`}
            >
              <span className="w-5 shrink-0 text-text-secondary">
                {isActive && isPlaying ? "⏸" : index + 1}
              </span>
              <span
                className={`truncate ${isActive ? "text-brand-primary" : "text-text-primary"}`}
              >
                {track.title}
              </span>
            </button>
            {duration && (
              <span className="shrink-0 text-xs text-text-secondary">
                {duration}
              </span>
            )}
            {track.priceCents != null && track.priceCents > 0 ? (
              <BuyButton
                variant="compact"
                title={track.title}
                priceCents={track.priceCents}
                studioTrackId={track.id}
              />
            ) : (
              <span className="shrink-0 text-xs font-medium text-brand-primary">
                {formatPriceCents(track.priceCents)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
