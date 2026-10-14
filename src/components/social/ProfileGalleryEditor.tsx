"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { authFetch } from "@/lib/authClient";
import {
  moveItem,
  planUploads,
  replaceOrder,
  skipMessage,
} from "@/lib/profileGalleryOrder";

// Owner-facing, editable media gallery shown on the owner's own profile Photos
// tab. Photos OR vertical videos, up to the server's slot count (MAX_SLOTS in
// /api/user/gallery, 20 for every account).
//
// Uploads use the same signed-URL flow as banners/avatars:
//   POST (sign) -> PUT file to storage -> PATCH (persist row).
//
// Editing is touch-first: every tile opens an action sheet (Replace, Make
// first, Move left/right, Delete). HTML5 drag-and-drop also works on desktop,
// but nothing depends on it because iOS Safari never fires drag events.

export type GalleryItem = {
  id: string;
  image_url: string;
  media_type?: "photo" | "video";
  sort_order: number;
};

type UploadRow = {
  key: string;
  name: string;
  status: "queued" | "uploading" | "saving" | "done" | "error";
  progress: number; // 0..100
  message?: string;
};

// PUT with upload progress (fetch has no upload progress events).
function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error("Upload failed"));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(file);
  });
}

async function readError(res: Response, fallback: string): Promise<string> {
  const j = await res.json().catch(() => ({}));
  return (j as { error?: string }).error ?? fallback;
}

export default function ProfileGalleryEditor({
  className = "",
  onChanged,
}: {
  className?: string;
  /** Called after any successful change so the parent can refresh counts. */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [max, setMax] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/user/gallery");
      if (!res.ok) return;
      const j = (await res.json()) as { photos: GalleryItem[]; max: number };
      setItems(Array.isArray(j.photos) ? j.photos : []);
      if (typeof j.max === "number") setMax(j.max);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchUpload = (key: string, patch: Partial<UploadRow>) =>
    setUploads((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // One file through sign -> PUT -> persist. Returns the saved row.
  const uploadOne = async (
    file: File,
    onProgress: (pct: number) => void,
    onSaving: () => void,
    replaceId?: string,
  ): Promise<GalleryItem> => {
    const isVideo = file.type.startsWith("video/");
    const signRes = await authFetch("/api/user/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        replace_id: replaceId,
      }),
    });
    if (!signRes.ok) throw new Error(await readError(signRes, "Could not start upload"));
    const { signedUrl, publicUrl } = (await signRes.json()) as {
      signedUrl: string;
      publicUrl: string;
    };
    await putWithProgress(signedUrl, file, onProgress);
    onSaving();
    const saveRes = await authFetch("/api/user/gallery", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicUrl,
        media_type: isVideo ? "video" : "photo",
        replace_id: replaceId,
      }),
    });
    if (!saveRes.ok) throw new Error(await readError(saveRes, "Could not save"));
    const { photo } = (await saveRes.json()) as { photo: GalleryItem };
    return photo;
  };

  // ---- Add (multi-select, sequential) --------------------------------------

  const onAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow reselecting the same files
    if (files.length === 0) return;
    setError(null);
    setNotice(null);

    const { accepted, skipped } = planUploads(files, max - items.length);
    const stamp = Date.now();
    const rows: UploadRow[] = [
      ...accepted.map((f, i) => ({
        key: `${stamp}-a${i}`,
        name: f.name,
        status: "queued" as const,
        progress: 0,
      })),
      ...skipped.map(({ file, reason }, i) => ({
        key: `${stamp}-s${i}`,
        name: file.name,
        status: "error" as const,
        progress: 0,
        message: `Skipped: ${skipMessage(reason, max)}`,
      })),
    ];
    setUploads(rows);
    if (accepted.length === 0) return;

    setBusy(true);
    let added = 0;
    for (let i = 0; i < accepted.length; i++) {
      const key = rows[i].key;
      patchUpload(key, { status: "uploading" });
      try {
        const photo = await uploadOne(
          accepted[i],
          (pct) => patchUpload(key, { progress: pct }),
          () => patchUpload(key, { status: "saving", progress: 100 }),
        );
        setItems((prev) => [...prev, photo]);
        patchUpload(key, { status: "done", progress: 100 });
        added += 1;
      } catch (err) {
        patchUpload(key, {
          status: "error",
          message: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }
    setBusy(false);
    if (added > 0) {
      setNotice(`Added ${added} ${added === 1 ? "item" : "items"}.`);
      onChanged?.();
    }
  };

  // ---- Reorder ---------------------------------------------------------------

  const persistOrder = async (ordered: GalleryItem[]): Promise<boolean> => {
    const res = await authFetch("/api/user/gallery", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ordered.map((it) => it.id) }),
    });
    return res.ok;
  };

  const reorder = async (from: number, to: number) => {
    const prev = items;
    const next = moveItem(prev, from, to);
    if (next === prev) return;
    setItems(next);
    setError(null);
    if (await persistOrder(next)) onChanged?.();
    else {
      setItems(prev);
      setError("Could not save the new order.");
    }
  };

  // ---- Delete ----------------------------------------------------------------

  const remove = async (id: string) => {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    setError(null);
    const res = await authFetch("/api/user/gallery", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) onChanged?.();
    else {
      setItems(prev);
      setError("Could not delete that item.");
    }
  };

  // ---- Replace ---------------------------------------------------------------
  // Upload the new file, persist it, move it into the old tile's position via
  // the reorder PATCH, then delete the old row. If the delete fails both stay
  // (old one last) and we say so.

  const startReplace = (id: string) => {
    replaceTarget.current = id;
    setMenuFor(null);
    replaceRef.current?.click();
  };

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const oldId = replaceTarget.current;
    replaceTarget.current = null;
    if (!file || !oldId) return;
    setError(null);
    setNotice(null);

    // One slot is freed by the swap, so the cap never blocks a replace.
    const { accepted, skipped } = planUploads([file], 1);
    if (accepted.length === 0) {
      setError(`Can't use ${file.name}: ${skipMessage(skipped[0].reason, max)}.`);
      return;
    }

    const key = `${Date.now()}-r`;
    setUploads([{ key, name: file.name, status: "uploading", progress: 0 }]);
    setBusy(true);
    try {
      const photo = await uploadOne(
        file,
        (pct) => patchUpload(key, { progress: pct }),
        () => patchUpload(key, { status: "saving", progress: 100 }),
        oldId,
      );

      const ids = replaceOrder(
        items.map((it) => it.id),
        oldId,
        photo.id,
      );
      const byId = new Map<string, GalleryItem>(
        [...items, photo].map((it) => [it.id, it]),
      );
      const ordered = ids.map((id) => byId.get(id)!).filter(Boolean);
      setItems(ordered);
      const orderOk = await persistOrder(ordered);

      const del = await authFetch("/api/user/gallery", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: oldId }),
      });
      if (del.ok) {
        setItems((prev) => prev.filter((it) => it.id !== oldId));
        patchUpload(key, { status: "done", progress: 100 });
        setNotice(
          orderOk
            ? "Replaced."
            : "Replaced, but the new one may show at the end. Use Move to fix it.",
        );
      } else {
        patchUpload(key, { status: "done", progress: 100 });
        setError(
          "The new one was added, but the old one couldn't be removed, so you have both. Delete the old one from its menu.",
        );
      }
      onChanged?.();
    } catch (err) {
      patchUpload(key, {
        status: "error",
        message: err instanceof Error ? err.message : "Replace failed",
      });
      setError("Replace failed. Your original is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------

  const isFull = items.length >= max;
  const menuIndex = menuFor ? items.findIndex((it) => it.id === menuFor) : -1;
  const menuItem = menuIndex >= 0 ? items[menuIndex] : null;
  const closeMenu = () => {
    setMenuFor(null);
    setConfirmDelete(false);
  };
  const canDrag = items.length > 1 && !busy;

  return (
    <section className={className} data-testid="profile-gallery-editor">
      {/* Header: count + Add */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-melori-text">Your photos</p>
          <p className="text-xs text-melori-muted" data-testid="gallery-count">
            {items.length} / {max}
            {items.length > 1 ? " · tap a photo to replace or move it" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => addRef.current?.click()}
          disabled={busy || isFull || loading}
          className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-full bg-melori-purple px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {isFull ? "Full" : "Add photos"}
        </button>
      </div>

      {/* Per-file upload progress */}
      {uploads.length > 0 && (
        <ul className="mb-3 space-y-1.5" aria-live="polite">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="rounded-lg border border-melori-border bg-melori-elevated px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-melori-text">{u.name}</span>
                <span
                  className={`shrink-0 ${
                    u.status === "error"
                      ? "text-red-400"
                      : u.status === "done"
                        ? "text-green-400"
                        : "text-melori-muted"
                  }`}
                >
                  {u.status === "queued" && "Waiting"}
                  {u.status === "uploading" && `${u.progress}%`}
                  {u.status === "saving" && "Saving…"}
                  {u.status === "done" && <Check className="h-4 w-4" />}
                  {u.status === "error" && "Not added"}
                </span>
              </div>
              {(u.status === "uploading" || u.status === "saving") && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-melori-border">
                  <div
                    className="h-full bg-melori-purple transition-all"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              )}
              {u.message && <p className="mt-1 text-red-400">{u.message}</p>}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {notice && !error && <p className="mb-3 text-sm text-green-400">{notice}</p>}

      {loading ? (
        <div className="flex justify-center py-16 text-melori-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {items.map((it, index) => (
            <div
              key={it.id}
              draggable={canDrag}
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                if (overIndex !== index) setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) void reorder(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`relative aspect-square overflow-hidden rounded-xl border bg-melori-elevated ${
                dragIndex === index
                  ? "border-melori-purple opacity-40"
                  : overIndex === index && dragIndex !== null
                    ? "border-melori-purple ring-2 ring-melori-purple"
                    : "border-melori-border"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setMenuFor(it.id);
                }}
                className="absolute inset-0 h-full w-full"
                aria-label={`Photo ${index + 1} options`}
              >
                {it.media_type === "video" ? (
                  <>
                    <video
                      src={it.image_url}
                      muted
                      playsInline
                      preload="metadata"
                      className="pointer-events-none h-full w-full object-cover"
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
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
              {index === 0 && (
                <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <Star className="h-3 w-3" /> Cover
                </span>
              )}
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
                <MoreHorizontal className="h-4 w-4" />
              </span>
            </div>
          ))}

          {!isFull && (
            <button
              type="button"
              onClick={() => addRef.current?.click()}
              disabled={busy}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-melori-border text-melori-muted transition hover:border-melori-purple hover:text-melori-purple disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-xs font-medium">Add photos</span>
                  <span className="text-[10px]">{max - items.length} left</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="mt-3 text-sm text-melori-muted">
          Add up to {max} photos or vertical videos. You can pick several at once.
        </p>
      )}

      <input
        ref={addRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={onAddFiles}
        className="hidden"
        data-testid="gallery-add-input"
      />
      <input
        ref={replaceRef}
        type="file"
        accept="image/*,video/*"
        onChange={onReplaceFile}
        className="hidden"
      />

      {/* Action sheet for one tile — bottom sheet on phones, centered card on desktop. */}
      {menuItem && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center"
          onClick={closeMenu}
          role="dialog"
          aria-modal="true"
          aria-label="Photo options"
        >
          <div
            className="w-full max-w-sm rounded-t-2xl border border-melori-border bg-melori-void p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-melori-elevated">
                {menuItem.media_type === "video" ? (
                  <video src={menuItem.image_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={menuItem.image_url} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <p className="flex-1 text-sm font-semibold text-melori-text">
                {menuIndex === 0 ? "Cover photo" : `Photo ${menuIndex + 1} of ${items.length}`}
              </p>
              <button
                type="button"
                onClick={closeMenu}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-full text-melori-muted hover:text-melori-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SheetButton
                icon={<RefreshCw className="h-4 w-4" />}
                label="Replace"
                disabled={busy}
                onClick={() => startReplace(menuItem.id)}
              />
              <SheetButton
                icon={<Star className="h-4 w-4" />}
                label="Make first"
                disabled={busy || menuIndex === 0}
                onClick={() => void reorder(menuIndex, 0)}
              />
              <SheetButton
                icon={<ArrowLeft className="h-4 w-4" />}
                label="Move left"
                disabled={busy || menuIndex === 0}
                onClick={() => void reorder(menuIndex, menuIndex - 1)}
              />
              <SheetButton
                icon={<ArrowRight className="h-4 w-4" />}
                label="Move right"
                disabled={busy || menuIndex === items.length - 1}
                onClick={() => void reorder(menuIndex, menuIndex + 1)}
              />
              <SheetButton
                icon={<Play className="h-4 w-4" />}
                label="View"
                onClick={() => {
                  setLightbox(menuItem);
                  closeMenu();
                }}
              />
              {confirmDelete ? (
                <SheetButton
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Tap to confirm"
                  danger
                  solid
                  disabled={busy}
                  onClick={() => {
                    const id = menuItem.id;
                    closeMenu();
                    void remove(id);
                  }}
                />
              ) : (
                <SheetButton
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Delete"
                  danger
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                />
              )}
            </div>
          </div>
        </div>
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
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </section>
  );
}

function SheetButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
  solid,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  solid?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition disabled:opacity-40 ${
        solid
          ? "border-red-500 bg-red-600 text-white"
          : danger
            ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
            : "border-melori-border bg-melori-elevated text-melori-text hover:border-melori-purple/40"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
