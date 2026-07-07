"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import TrackReplacePanel from "./TrackReplacePanel";
import TrackEditModal, { type EditableTrack } from "./TrackEditModal";

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  status: "draft" | "scheduled" | "published" | "archived";
  preview_url: string | null;
  created_at: string;
  duration: number | null;
  sort_order: number | null;
}

interface TrackListProps {
  onEditWaveform: (trackId: string) => void;
}

// Normalize an album name for grouping. Null/empty/whitespace all collapse
// to a single "no album" bucket keyed by null. Matches server-side
// treatment in POST /api/studio/tracks (trim + fallback to null).
function normalizeAlbum(album: string | null | undefined): string | null {
  if (typeof album !== "string") return null;
  const trimmed = album.trim();
  return trimmed === "" ? null : trimmed;
}

export default function TrackList({ onEditWaveform }: TrackListProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Track["status"]>("all");
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingTrack, setEditingTrack] = useState<EditableTrack | null>(null);
  const [reorderingAlbum, setReorderingAlbum] = useState<string | null>(null);

  const deleteTrack = useCallback(async (trackId: string, title: string) => {
    if (
      !window.confirm(
        `Delete “${title}” permanently? This removes the master audio, cover art, and preview clip. This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(trackId);
    try {
      const res = await authFetch(`/api/studio/track/${trackId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        window.alert(err?.error ?? "Failed to delete track.");
        return;
      }
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
    } finally {
      setDeletingId(null);
    }
  }, []);

  const setStatus = useCallback(
    async (trackId: string, status: Track["status"]) => {
      setPublishingId(trackId);
      try {
        const res = await authFetch(`/api/studio/track/${trackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const newStatus: Track["status"] = data?.track?.status ?? status;
        setTracks((prev) =>
          prev.map((t) => (t.id === trackId ? { ...t, status: newStatus } : t)),
        );
      } finally {
        setPublishingId(null);
      }
    },
    [],
  );

  const loadTracks = useCallback(() => {
    return authFetch("/api/studio/tracks")
      .then((r) => r.json())
      .then((data) => {
        setTracks(data.tracks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // Applied AFTER grouping so reorder buttons still reference the full album
  // even when a status filter is on. Filtering visually hides rows, but the
  // move-up/move-down operates against the DB row order for the album,
  // which is what actually persists.
  const filteredTracks = filter === "all" ? tracks : tracks.filter((t) => t.status === filter);

  // Group by album for rendering with headers. Album labels are the trimmed
  // string; the "no album" bucket is keyed under a sentinel and rendered
  // last. Ordering within each bucket comes from the API (already sorted by
  // sort_order asc, created_at desc as tiebreaker).
  const albumGroups = useMemo(() => {
    const map = new Map<string | null, Track[]>();
    for (const t of filteredTracks) {
      const key = normalizeAlbum(t.album);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    // Sort: named albums alphabetically, then null bucket last.
    const named: [string, Track[]][] = [];
    let nullBucket: Track[] | null = null;
    for (const [key, list] of map.entries()) {
      if (key == null) nullBucket = list;
      else named.push([key, list]);
    }
    named.sort(([a], [b]) => a.localeCompare(b));
    const result: { album: string | null; tracks: Track[] }[] = named.map(
      ([album, tracks]) => ({ album, tracks }),
    );
    if (nullBucket) result.push({ album: null, tracks: nullBucket });
    return result;
  }, [filteredTracks]);

  // Reorder handler. `direction = -1` moves up, `+1` moves down. Only enabled
  // between siblings in the SAME album; the API refuses cross-album lists.
  // Optimistic: swap in local state first, then POST; on failure re-load.
  const moveTrack = useCallback(
    async (albumKey: string | null, trackId: string, direction: -1 | 1) => {
      // Compute the desired new order from CURRENT full-track list (not
      // filtered) so filtering by status doesn't scramble album ordering.
      const albumTracks = tracks
        .filter((t) => normalizeAlbum(t.album) === albumKey)
        .slice()
        // Preserve API ordering: use sort_order asc with created_at desc as
        // the same tiebreaker the server applies.
        .sort((a, b) => {
          const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
          const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return b.created_at.localeCompare(a.created_at);
        });

      const idx = albumTracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return;
      const swapWith = idx + direction;
      if (swapWith < 0 || swapWith >= albumTracks.length) return;

      // Build the new ordered list for this album (swap the two neighbors).
      const newOrder = albumTracks.slice();
      [newOrder[idx], newOrder[swapWith]] = [newOrder[swapWith], newOrder[idx]];
      const orderedIds = newOrder.map((t) => t.id);

      // Optimistic UI: rewrite sort_order locally so the grid reflects the
      // swap immediately. On failure we re-fetch to restore the truth.
      setReorderingAlbum(albumKey);
      const optimistic = tracks.map((t) => {
        const pos = orderedIds.indexOf(t.id);
        if (pos === -1) return t;
        return { ...t, sort_order: pos + 1 };
      });
      setTracks(optimistic);

      try {
        const res = await authFetch(`/api/studio/tracks/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ album: albumKey, orderedIds }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          window.alert(err?.error ?? "Failed to reorder.");
          await loadTracks();
        }
      } catch {
        await loadTracks();
      } finally {
        setReorderingAlbum(null);
      }
    },
    [tracks, loadTracks],
  );

  const applyEdit = useCallback((updated: EditableTrack) => {
    // A metadata edit may have changed the album, which server-side reset
    // sort_order. Re-fetch the whole list so the row lands in its correct
    // group with its new sort_order. If album didn't change this is a
    // small waste, but keeps the state correct without duplicating server
    // logic on the client.
    setEditingTrack(null);
    loadTracks();
  }, [loadTracks]);

  const statusColors: Record<string, string> = {
    draft: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    published: "bg-green-500/10 text-green-400 border-green-500/20",
    archived: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  const statusLabels: Record<string, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    published: "Published",
    archived: "Archived",
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading your tracks...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Tabs — horizontally scrollable on narrow screens so all four
          status buttons stay reachable without truncation. */}
      <div className="flex gap-2 flex-wrap overflow-x-auto -mx-1 px-1">
        {(["all", "draft", "scheduled", "published", "archived"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer whitespace-nowrap
              ${filter === s
                ? "bg-[#c9a96e]/15 text-[#c9a96e] border border-[#c9a96e]/30"
                : "bg-white/5 text-[#888] border border-white/10 hover:border-white/20"
              }`}
          >
            {s === "all" ? "All Tracks" : statusLabels[s]}
            {s !== "all" && (
              <span className="ml-2 text-xs opacity-60">
                {tracks.filter((t) => t.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Track Grid — grouped by album */}
      {filteredTracks.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.02] border border-white/[0.08] rounded-2xl">
          <p className="text-4xl mb-3">🎵</p>
          <p className="text-[#888] text-lg">
            {filter === "all" ? "No tracks yet. Upload your first!" : `No ${filter} tracks.`}
          </p>
          {filter === "all" && (
            <Link
              href="/studio?tab=upload"
              className="inline-block mt-4 px-6 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
            >
              Upload Track
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {albumGroups.map((group) => (
            <section key={group.album ?? "__no_album__"}>
              {/* Album header. When there's only one album total we still show
                  it so the artist knows what "up/down" reorders within. */}
              <h3 className="text-sm uppercase tracking-widest text-[#888] mb-3 px-1">
                {group.album ?? "Singles / Uncategorized"}
                <span className="ml-2 text-xs text-[#666] normal-case tracking-normal">
                  {group.tracks.length} {group.tracks.length === 1 ? "track" : "tracks"}
                </span>
              </h3>

              <div className="grid gap-4">
                {group.tracks.map((track, idxInGroup) => (
                  <div key={track.id}>
                    <div
                      className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 hover:border-[#c9a96e]/20 transition-all"
                    >
                      {/* Row 1 on mobile: art + info + reorder arrows. On
                          desktop this stays a single flex row. */}
                      <div className="flex items-center gap-4 sm:gap-5 flex-1 min-w-0">
                        {/* Reorder arrows. Disabled at the ends of the album
                            list. Kept small so on mobile they don't eat the
                            row. */}
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button
                            onClick={() => moveTrack(group.album, track.id, -1)}
                            disabled={
                              idxInGroup === 0 ||
                              reorderingAlbum === group.album ||
                              group.tracks.length < 2
                            }
                            className="w-7 h-7 flex items-center justify-center rounded bg-white/5 border border-white/10 text-xs text-[#888] hover:border-[#c9a96e]/40 hover:text-[#c9a96e] disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move up in album"
                            aria-label="Move up"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveTrack(group.album, track.id, 1)}
                            disabled={
                              idxInGroup === group.tracks.length - 1 ||
                              reorderingAlbum === group.album ||
                              group.tracks.length < 2
                            }
                            className="w-7 h-7 flex items-center justify-center rounded bg-white/5 border border-white/10 text-xs text-[#888] hover:border-[#c9a96e]/40 hover:text-[#c9a96e] disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down in album"
                            aria-label="Move down"
                          >
                            ▼
                          </button>
                        </div>

                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-[#c9a96e]/20 to-[#a08050]/20 flex items-center justify-center text-2xl flex-shrink-0">
                          🎵
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                            <h3 className="font-semibold truncate">{track.title}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[track.status]}`}>
                              {statusLabels[track.status]}
                            </span>
                          </div>
                          <p className="text-sm text-[#888] truncate">
                            {track.artist}
                            {track.genre && ` • ${track.genre}`}
                          </p>
                          <p className="text-xs text-[#666] mt-1">
                            {track.preview_url ? "✓ Preview ready" : "⚠ No preview"}
                            {track.duration && ` • ${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}`}
                          </p>
                        </div>
                      </div>

                      {/* Actions. On mobile these wrap to a second row under
                          the info block; on desktop they sit inline. */}
                      <div className="flex gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
                        <button
                          onClick={() =>
                            setEditingTrack({
                              id: track.id,
                              title: track.title,
                              artist: track.artist,
                              album: track.album,
                              genre: track.genre,
                            })
                          }
                          className="px-3 sm:px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-[#c9a96e]/40 transition-all"
                          title="Edit title, artist, album, genre"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => onEditWaveform(track.id)}
                          className="px-3 sm:px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-[#c9a96e]/40 transition-all"
                          title="Edit 30-second preview"
                        >
                          ✂️ Preview
                        </button>
                        <button
                          onClick={() =>
                            setReplacingId((id) => (id === track.id ? null : track.id))
                          }
                          className={`px-3 sm:px-4 py-2 border rounded-lg text-sm font-medium transition-all ${
                            replacingId === track.id
                              ? "bg-[#c9a96e]/15 text-[#c9a96e] border-[#c9a96e]/40"
                              : "bg-white/5 border-white/10 hover:border-[#c9a96e]/40"
                          }`}
                          title="Replace the master audio for this track"
                        >
                          🔁 Replace
                        </button>
                        {track.status === "published" ? (
                          <button
                            onClick={() => setStatus(track.id, "draft")}
                            disabled={publishingId === track.id}
                            className="px-3 sm:px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-yellow-500/40 transition-all disabled:opacity-50"
                            title="Revert to draft (unpublish)"
                          >
                            {publishingId === track.id ? "…" : "Unpublish"}
                          </button>
                        ) : (
                          <button
                            onClick={() => setStatus(track.id, "published")}
                            disabled={publishingId === track.id}
                            className="px-3 sm:px-4 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm font-medium hover:border-green-500/60 transition-all disabled:opacity-50"
                            title="Publish this track"
                          >
                            {publishingId === track.id ? "…" : "Publish"}
                          </button>
                        )}
                        <Link
                          href={`/music/${track.id}`}
                          className="px-3 sm:px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-[#c9a96e]/40 transition-all"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => deleteTrack(track.id, track.title)}
                          disabled={deletingId === track.id}
                          className="px-3 sm:px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm font-medium hover:border-red-500/60 transition-all disabled:opacity-50"
                          title="Delete this track permanently"
                        >
                          {deletingId === track.id ? "…" : "🗑 Delete"}
                        </button>
                      </div>
                    </div>

                    {replacingId === track.id && (
                      <TrackReplacePanel
                        trackId={track.id}
                        trackTitle={track.title}
                        onClose={() => setReplacingId(null)}
                        onReplaced={loadTracks}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editingTrack && (
        <TrackEditModal
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={applyEdit}
        />
      )}
    </div>
  );
}
