"use client";

import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";
import type { Track } from "@/types";

interface PlayReleaseButtonProps {
  tracks: Track[];
  artistName: string | null;
  coverUrl: string | null;
}

// Prominent "Play" button for a release page. Free streaming is the platform's
// core promise, so this sits right beside the Buy button and starts the whole
// release playing from the first playable track. Mirrors the queue TrackList
// builds so the player state stays consistent whichever control the user taps.
export default function PlayReleaseButton({
  tracks,
  artistName,
  coverUrl,
}: PlayReleaseButtonProps) {
  const { current, isPlaying, playQueue, togglePlay } = usePlayer();

  const queue: PlayerTrack[] = tracks
    .filter((t) => Boolean(t.audio_url || t.preview_url))
    .map((t) => ({ id: t.id, title: t.title, artistName, coverUrl }));

  if (queue.length === 0) return null;

  const isThisRelease = queue.some((q) => q.id === current?.id);
  const showPause = isThisRelease && isPlaying;

  function handleClick() {
    if (isThisRelease) {
      togglePlay();
    } else {
      playQueue(queue, 0);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={showPause ? "Pause" : "Play release for free"}
      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
    >
      {showPause ? (
        <>
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
          Pause
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M8 5v14l11-7z" />
          </svg>
          Play free
        </>
      )}
    </button>
  );
}
