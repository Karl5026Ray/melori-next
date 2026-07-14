"use client";

import { useEffect, useState } from "react";
import { Check, Plus, X, Loader2, ListMusic } from "lucide-react";
import type { RadioTrack } from "@/lib/data";
import { usePlaylists, type TrackRef } from "@/components/radio/usePlaylists";

function refOf(t: RadioTrack): TrackRef {
  return { sourceType: t.sourceType, id: t.id };
}

// Bottom sheet to add the given track to one or more saved playlists, or create
// a new playlist on the spot. Checkmarks reflect which playlists already hold
// the track; tapping toggles membership.
export default function AddToPlaylistSheet({
  track,
  onClose,
}: {
  track: RadioTrack;
  onClose: () => void;
}) {
  const pl = usePlaylists();
  const [inIds, setInIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      await pl.refresh();
      const ids = await pl.containing(refOf(track));
      if (alive) {
        setInIds(new Set(ids));
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.sourceType]);

  const toggle = async (playlistId: string) => {
    setBusy(playlistId);
    const isIn = inIds.has(playlistId);
    const ok = isIn
      ? await pl.removeTrack(playlistId, refOf(track))
      : await pl.addTrack(playlistId, refOf(track));
    if (ok) {
      setInIds((prev) => {
        const next = new Set(prev);
        if (isIn) next.delete(playlistId);
        else next.add(playlistId);
        return next;
      });
      await pl.refresh();
    }
    setBusy(null);
  };

  const createAndAdd = async () => {
    if (!newName.trim()) return;
    setBusy("__new__");
    const created = await pl.create(newName.trim());
    if (created) {
      await pl.addTrack(created.id, refOf(track));
      setInIds((prev) => new Set(prev).add(created.id));
      await pl.refresh();
      setNewName("");
      setCreating(false);
    }
    setBusy(null);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add to playlist"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-md rounded-t-3xl border border-brand-border bg-brand-surface p-5 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListMusic className="h-5 w-5 text-brand-primary" />
            <h2 className="text-base font-bold text-text-primary">
              Add to playlist
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 truncate text-sm text-text-secondary">
          {track.title} · {track.artistName ?? "Unknown artist"}
        </p>

        {!ready ? (
          <div className="flex h-32 items-center justify-center text-text-secondary">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {pl.playlists.length === 0 && !creating && (
                <p className="py-4 text-center text-sm text-text-secondary">
                  No playlists yet — create your first one below.
                </p>
              )}
              {pl.playlists.map((p) => {
                const isIn = inIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    disabled={busy === p.id}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">
                        {p.name}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
                      </span>
                    </span>
                    {busy === p.id ? (
                      <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
                    ) : (
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                          isIn
                            ? "border-brand-primary bg-brand-primary text-white"
                            : "border-brand-border text-transparent"
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Create new playlist */}
            {creating ? (
              <div className="mt-3 flex items-center gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createAndAdd();
                  }}
                  placeholder="Playlist name"
                  maxLength={80}
                  className="flex-1 rounded-xl border border-brand-border bg-transparent px-3 py-2.5 text-sm text-text-primary outline-none focus:border-brand-primary"
                />
                <button
                  onClick={createAndAdd}
                  disabled={!newName.trim() || busy === "__new__"}
                  className="rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy === "__new__" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-brand-border px-3 py-3 text-sm font-medium text-brand-primary hover:bg-white/[0.03]"
              >
                <Plus className="h-4 w-4" />
                New playlist
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
