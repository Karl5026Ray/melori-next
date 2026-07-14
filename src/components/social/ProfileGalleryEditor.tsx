"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Trash2, Play, X, GripVertical } from "lucide-react";
import { authFetch } from "@/lib/authClient";

// Owner-facing, editable media gallery shown on the user's own profile page.
// Photos OR vertical videos, up to a tier-based slot count (server-enforced):
//   free -> 4, superfan -> 20, artist -> 20.
// Uploads use the same signed-URL flow as banners/avatars:
//   POST (sign) -> PUT file to storage -> PATCH (persist row).

type Item = {
  id: string;
  image_url: string;
  media_type?: "photo" | "video";
  sort_order: number;
};

// Generous ceilings; the storage bucket + tier count are the real guards.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB

export default function ProfileGalleryEditor({
  className = "",
}: {
  className?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [max, setMax] = useState<number>(4);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Item | null>(null);
  // Index of the tile currently being dragged, and the index it's hovering
  // over, so we can show a live insertion preview and reorder on drop.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await authFetch("/api/user/gallery");
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const j = (await res.json()) as { photos: Item[]; max: number };
      setItems(Array.isArray(j.photos) ? j.photos : []);
      if (typeof j.max === "number") setMax(j.max);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow reselecting the same file
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      setError("Choose an image or a video.");
      return;
    }
    if (isImage && file.size > MAX_IMAGE_BYTES) {
      setError("Images must be under 12MB.");
      return;
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      setError("Videos must be under 60MB. Try a shorter clip.");
      return;
    }
    if (items.length >= max) {
      setError(`You've used all ${max} slots on your plan.`);
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const signRes = await authFetch("/api/user/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!signRes.ok) {
        const j = await signRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Could not start upload");
      }
      const { signedUrl, publicUrl } = (await signRes.json()) as {
        signedUrl: string;
        publicUrl: string;
      };

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");

      const saveRes = await authFetch("/api/user/gallery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicUrl,
          media_type: isVideo ? "video" : "photo",
        }),
      });
      if (!saveRes.ok) {
        const j = await saveRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Could not save media");
      }
      const { photo } = (await saveRes.json()) as { photo: Item };
      setItems((prev) => [...prev, photo]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    // Optimistic removal.
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    const res = await authFetch("/api/user/gallery", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      setItems(prev); // roll back
      setError("Could not delete that item.");
    }
  };

  // Persist the current order to the server. The PATCH endpoint accepts an
  // `order` array of ids and rewrites sort_order to match.
  const persistOrder = async (ordered: Item[]) => {
    const res = await authFetch("/api/user/gallery", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ordered.map((it) => it.id) }),
    });
    if (!res.ok) setError("Could not save the new order.");
  };

  // Move the item at `from` to `to`, update local state optimistically, and
  // persist. Used by both mouse drag-and-drop and touch reordering.
  const moveItem = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setItems((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      void persistOrder(next);
      return next;
    });
  };

  const handleDrop = (to: number) => {
    if (dragIndex !== null) moveItem(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  const isFull = items.length >= max;
  const canReorder = items.length > 1;

  return (
    <section className={`glass rounded-2xl p-6 ${className}`}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold">Photos &amp; Videos</h3>
        <span className="text-xs text-melori-muted">
          {items.length} / {max} slots
        </span>
      </div>
      {canReorder && (
        <p className="mb-4 text-xs text-melori-muted">
          Drag any tile to reorder how your media appears.
        </p>
      )}
      {!canReorder && <div className="mb-4" />}

      {loading ? (
        <div className="py-8 text-center text-sm text-melori-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it, index) => (
              <div
                key={it.id}
                data-tile-index={index}
                draggable={canReorder}
                onDragStart={(e) => {
                  setDragIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overIndex !== index) setOverIndex(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(index);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`group relative aspect-[3/4] overflow-hidden rounded-xl border bg-melori-void/40 transition ${
                  dragIndex === index
                    ? "border-brand-primary opacity-40"
                    : overIndex === index && dragIndex !== null
                      ? "border-brand-primary ring-2 ring-brand-primary"
                      : "border-brand-border"
                } ${canReorder ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(it)}
                  className="absolute inset-0 h-full w-full"
                  aria-label="View"
                >
                  {it.media_type === "video" ? (
                    <>
                      <video
                        src={it.image_url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white">
                          <Play className="h-4 w-4" />
                        </span>
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  aria-label="Delete"
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>

                {/* Drag handle — also drives touch reordering on mobile. */}
                {canReorder && (
                  <div
                    role="button"
                    aria-label="Drag to reorder"
                    onTouchStart={() => setDragIndex(index)}
                    onTouchMove={(e) => {
                      const t = e.touches[0];
                      const el = document
                        .elementFromPoint(t.clientX, t.clientY)
                        ?.closest("[data-tile-index]") as HTMLElement | null;
                      if (el) {
                        const to = Number(el.dataset.tileIndex);
                        if (!Number.isNaN(to) && to !== overIndex) setOverIndex(to);
                      }
                    }}
                    onTouchEnd={() => {
                      if (overIndex !== null) handleDrop(overIndex);
                      else {
                        setDragIndex(null);
                        setOverIndex(null);
                      }
                    }}
                    className="absolute left-1.5 top-1.5 flex h-7 w-7 touch-none items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))}

            {/* Add tile — only when a slot is free. */}
            {!isFull && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-border text-melori-muted transition hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <>
                    <ImagePlus className="h-6 w-6" />
                    <span className="text-[11px] font-medium">Add media</span>
                  </>
                )}
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            onChange={onFile}
            className="hidden"
          />

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {items.length === 0 && (
            <p className="mt-3 text-sm text-melori-muted">
              Add up to {max} photos or vertical videos to bring your profile to
              life.
            </p>
          )}

          {isFull && max === 4 && (
            <p className="mt-3 text-sm text-melori-muted">
              You&apos;ve filled all 4 free slots.{" "}
              <Link
                href="/membership"
                className="font-semibold text-brand-primary hover:underline"
              >
                Go Superfan
              </Link>{" "}
              for 20 slots.
            </p>
          )}
        </>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          {lightbox.media_type === "video" ? (
            <video
              src={lightbox.image_url}
              controls
              autoPlay
              playsInline
              className="h-auto max-h-[90vh] w-auto max-w-[92vw] rounded-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.image_url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="h-auto max-h-[90vh] w-auto max-w-[92vw] rounded-2xl object-contain"
            />
          )}
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </section>
  );
}
