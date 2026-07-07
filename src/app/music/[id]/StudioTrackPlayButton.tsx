"use client";

import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";

// Client-side play button for the /music/[id] studio track detail page.
// Routes through the shared PlayerProvider so listen events get logged for
// superfans (the raw <audio> element that used to live here bypassed both
// auth and analytics).
export default function StudioTrackPlayButton({
  track,
}: {
  track: {
    id: string;
    title: string;
    displayArtist: string;
    coverUrl: string | null;
  };
}) {
  const { current, isPlaying, playQueue } = usePlayer();

  const queueTrack: PlayerTrack = {
    id: track.id,
    title: track.title,
    artistName: track.displayArtist,
    coverUrl: track.coverUrl,
    sourceType: "studio",
  };

  const isActive =
    current?.sourceType === "studio" && current?.id === track.id;
  const showPause = isActive && isPlaying;

  return (
    <button
      type="button"
      onClick={() => playQueue([queueTrack], 0)}
      className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#c9a96e] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#d9b97e]"
    >
      <span aria-hidden>{showPause ? "⏸" : "▶"}</span>
      <span>{showPause ? "Pause" : "Play"}</span>
    </button>
  );
}
