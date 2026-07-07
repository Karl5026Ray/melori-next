"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/authClient";

// Track metadata editor. Renders as a fixed-position modal over the studio
// grid. Only patches fields the artist changed — sending unchanged values
// still hits the DB, and the PATCH endpoint already rejects empty updates,
// so we skip the request if nothing changed.

export interface EditableTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
}

interface TrackEditModalProps {
  track: EditableTrack;
  onClose: () => void;
  onSaved: (updated: EditableTrack) => void;
}

export default function TrackEditModal({
  track,
  onClose,
  onSaved,
}: TrackEditModalProps) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album ?? "");
  const [genre, setGenre] = useState(track.genre ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape to close is muscle memory on desktop and free on mobile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSave = async () => {
    setError(null);

    // Build a diff of only the fields that actually changed. The PATCH
    // endpoint requires at least one field or it 400s, so an unchanged save
    // is a no-op — just close.
    const payload: Record<string, string> = {};
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title cannot be empty.");
      return;
    }
    if (trimmedTitle !== track.title) payload.title = trimmedTitle;

    const trimmedArtist = artist.trim();
    if (trimmedArtist !== (track.artist ?? "")) payload.artist = trimmedArtist;

    const trimmedAlbum = album.trim();
    if (trimmedAlbum !== (track.album ?? "")) payload.album = trimmedAlbum;

    const trimmedGenre = genre.trim();
    if (trimmedGenre !== (track.genre ?? "")) payload.genre = trimmedGenre;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch(`/api/studio/track/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error ?? "Failed to save changes.");
        return;
      }
      // Reflect the trimmed values back to the parent so the list re-renders
      // with the artist's intended casing/spacing, not whatever they typed.
      onSaved({
        id: track.id,
        title: trimmedTitle,
        artist: trimmedArtist,
        album: trimmedAlbum || null,
        genre: trimmedGenre || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit track</h2>
          <button
            onClick={() => !saving && onClose()}
            className="text-[#888] hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-[#888] uppercase tracking-wide">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#c9a96e]/40 focus:outline-none"
              disabled={saving}
            />
          </label>

          <label className="block">
            <span className="text-xs text-[#888] uppercase tracking-wide">Artist</span>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#c9a96e]/40 focus:outline-none"
              disabled={saving}
            />
          </label>

          <label className="block">
            <span className="text-xs text-[#888] uppercase tracking-wide">Album</span>
            <input
              type="text"
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="(none)"
              className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#c9a96e]/40 focus:outline-none"
              disabled={saving}
            />
            <span className="text-xs text-[#666] mt-1 block">
              Moving to a different album resets this track's position to the end of that album.
            </span>
          </label>

          <label className="block">
            <span className="text-xs text-[#888] uppercase tracking-wide">Genre</span>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="(none)"
              className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#c9a96e]/40 focus:outline-none"
              disabled={saving}
            />
          </label>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-white/20 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
