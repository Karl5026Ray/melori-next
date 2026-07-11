"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StudioTrackListItem } from "@/lib/data";
import { usePlayer, type PlayerTrack } from "@/components/player/PlayerProvider";

// Public-site presentation of studio_tracks (artist self-uploads).
//
// This is a small, self-contained Client Component: it doesn't share
// MusicCatalog's filter/search state because the two lists have different
// shapes (studio_tracks are flat singles, releases can be albums with track
// counts). If the two schemas ever converge, this can fold into MusicCatalog
// — until then, keeping them separate avoids the "everything's an album"
// mismatch that would show up as a broken album view.
//
// Playback: the card is still a Link to /music/[id] for the detail view, but
// a small play-overlay button on the cover triggers the shared PlayerProvider
// with sourceType="studio". This is what plumbs studio_tracks through the
// unified audio pipeline so listen events actually get logged.
export default function StudioTrackGrid({
  tracks,
}: {
  tracks: StudioTrackListItem[];
}) {
  const { current, isPlaying, playQueue } = usePlayer();
  const [query, setQuery] = useState("");

  // Filter the collection by title or artist — mirrors the admin Uploads
  // Collection search so the public list behaves the same way. Case-
  // insensitive substring match on the display artist (profile name falls
  // back to the free-text artist field) and the title.
  const visibleTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => {
      const artist =
        t.profile?.display_name?.trim() || t.artist || "";
      return (
        (t.title ?? "").toLowerCase().includes(q) ||
        artist.toLowerCase().includes(q)
      );
    });
  }, [tracks, query]);

  if (tracks.length === 0) return null;

  // Build the queue from the visible (filtered) list so play + auto-advance
  // stay in sync with what the listener actually sees.
  const queue: PlayerTrack[] = visibleTracks.map((t) => ({
    id: t.id,
    title: t.title,
    artistName:
      t.profile?.display_name?.trim() || t.artist || null,
    coverUrl: t.cover_url ?? null,
    sourceType: "studio" as const,
  }));

  return (
    <section>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Latest from Artists</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Fresh uploads straight from the MELORI Artist Studio.
        </p>
      </div>

      <div className="mb-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or artist…"
          className="w-full rounded-md border border-input-border bg-brand-surface px-4 py-2 text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none sm:max-w-sm"
        />
      </div>

      {visibleTracks.length === 0 ? (
        <p className="text-text-secondary">No uploads match your search.</p>
      ) : (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTracks.map((track, idx) => {
          const displayArtist =
            track.profile?.display_name?.trim() || track.artist;
          // Match on the composite (id + source) since studio ids are UUIDs
          // but a mixed queue on other pages could contain legacy tracks too.
          const isActive =
            current?.sourceType === "studio" && current?.id === track.id;

          const handlePlayClick = (e: React.MouseEvent) => {
            // Prevent the wrapping Link from navigating on play-button clicks.
            e.preventDefault();
            e.stopPropagation();
            playQueue(queue, idx);
          };

          return (
            <Link
              key={track.id}
              href={`/music/${track.id}`}
              className="group relative flex gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-[#c9a96e]/30"
            >
              <div className="relative h-20 w-20 flex-shrink-0">
                {track.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.cover_url}
                    alt={`${track.title} cover art`}
                    className="h-20 w-20 rounded-xl object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-[#c9a96e]/20 to-[#a08050]/20 text-2xl">
                    🎵
                  </div>
                )}
                <button
                  type="button"
                  onClick={handlePlayClick}
                  aria-label={
                    isActive && isPlaying
                      ? `Pause ${track.title}`
                      : `Play ${track.title}`
                  }
                  className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 text-2xl text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
                >
                  {isActive && isPlaying ? "⏸" : "▶"}
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold group-hover:text-[#c9a96e]">
                  {track.title}
                </h3>
                <p className="mt-0.5 truncate text-sm text-text-secondary">
                  {displayArtist}
                  {track.album ? ` · ${track.album}` : ""}
                </p>
                <p className="mt-1 text-xs text-text-secondary/70">
                  {track.genre ?? "Single"}
                  {track.preview_url ? " · Preview available" : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
      )}
    </section>
  );
}
