"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Star, Trash2, Power } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import UploadPanel from "./UploadPanel";
import ImageCard from "./ImageCard";
import type {
  GalleryFolderItem,
  GalleryImageItem,
  GalleryListItem,
} from "./types";

interface Props {
  gallery: GalleryListItem;
  onBack: () => void;
  onGalleryChanged: (gallery: GalleryListItem) => void;
  onGalleryDeleted: (galleryId: string) => void;
}

const PREVIEWS_BUCKET = "gallery-previews";

export default function GalleryDetail({
  gallery,
  onBack,
  onGalleryChanged,
  onGalleryDeleted,
}: Props) {
  const [images, setImages] = useState<GalleryImageItem[]>([]);
  const [folders, setFolders] = useState<GalleryFolderItem[]>([]);
  const [coverImageId, setCoverImageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const galleryGridRef = useRef<HTMLDivElement>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from("photo_gallery_images")
        .select(
          "id, folder_id, preview_key, thumbnail_key, caption, filename, for_sale, price_cents, order_index",
        )
        .eq("gallery_id", gallery.id)
        .order("order_index", { ascending: true });
      if (qErr) throw new Error(qErr.message);

      const rows: GalleryImageItem[] = (data ?? []).map((img) => ({
        id: img.id as string,
        folderId: (img.folder_id as string | null) ?? null,
        previewUrl: supabase.storage
          .from(PREVIEWS_BUCKET)
          .getPublicUrl(img.preview_key as string).data.publicUrl,
        thumbnailUrl: supabase.storage
          .from(PREVIEWS_BUCKET)
          .getPublicUrl(img.thumbnail_key as string).data.publicUrl,
        caption: img.caption as string | null,
        filename: img.filename as string | null,
        forSale: Boolean(img.for_sale),
        priceCents: img.price_cents as number | null,
        orderIndex: img.order_index as number,
      }));
      setImages(rows);

      const { data: folderRows } = await supabase
        .from("photo_gallery_folders")
        .select("id, name, cover_photo_id")
        .eq("gallery_id", gallery.id)
        .order("order_index", { ascending: true });
      setFolders(
        (folderRows ?? []).map((f) => ({
          id: f.id as string,
          name: f.name as string,
          coverPhotoId: (f.cover_photo_id as string | null) ?? null,
        })),
      );

      // Resolve which image is currently the cover by matching thumbnail_key
      // against the gallery's cover_image_key.
      const { data: galRow } = await supabase
        .from("photo_galleries")
        .select("cover_image_key")
        .eq("id", gallery.id)
        .maybeSingle();
      const coverKey = galRow?.cover_image_key as string | null;
      if (coverKey) {
        const match = (data ?? []).find((img) => img.thumbnail_key === coverKey);
        setCoverImageId((match?.id as string) ?? null);
      } else {
        setCoverImageId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load photos");
    } finally {
      setLoading(false);
    }
  }, [gallery.id]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const handleSetCover = async (imageId: string) => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/studio/gallery/${gallery.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverImageId: imageId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not set cover");
      setCoverImageId(imageId);
      const img = images.find((i) => i.id === imageId);
      if (img) {
        onGalleryChanged({ ...gallery, coverUrl: img.thumbnailUrl });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set cover");
    } finally {
      setBusy(false);
    }
  };

  // Group photos by folder for the manager grid: unfiled photos first, then
  // each folder in its display order. Mirrors the public viewer's grouping.
  const groups = useMemo(() => {
    const byFolder = new Map<string | null, GalleryImageItem[]>();
    for (const img of images) {
      if (!byFolder.has(img.folderId)) byFolder.set(img.folderId, []);
      byFolder.get(img.folderId)!.push(img);
    }
    const result: { folder: GalleryFolderItem | null; items: GalleryImageItem[] }[] =
      [];
    const unfiled = byFolder.get(null);
    if (unfiled?.length) result.push({ folder: null, items: unfiled });
    for (const folder of folders) {
      const items = byFolder.get(folder.id);
      if (items?.length) result.push({ folder, items });
    }
    return result;
  }, [images, folders]);

  const handleSetFolderCover = async (
    folderId: string,
    photoId: string | null,
  ) => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/studio/gallery/folder/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverPhotoId: photoId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not set folder cover");
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId ? { ...f, coverPhotoId: photoId } : f,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not set folder cover",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleImageDeleted = (imageId: string) => {
    setImages((prev) => prev.filter((i) => i.id !== imageId));
    // The FK is `on delete set null`, so mirror that locally.
    setFolders((prev) =>
      prev.map((f) => (f.coverPhotoId === imageId ? { ...f, coverPhotoId: null } : f)),
    );
    onGalleryChanged({ ...gallery, imageCount: Math.max(0, gallery.imageCount - 1) });
  };

  const handleImageUpdated = (updated: GalleryImageItem) => {
    setImages((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  const handleToggleActive = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/studio/gallery/${gallery.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !gallery.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Update failed");
      onGalleryChanged({ ...gallery, isActive: !gallery.isActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGallery = async () => {
    if (
      !window.confirm(
        `Delete "${gallery.name}" and all ${gallery.imageCount} photo(s)? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/studio/gallery/${gallery.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      onGalleryDeleted(gallery.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> All galleries
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary truncate">{gallery.name}</h1>
          {gallery.clientName && (
            <p className="text-sm text-text-secondary mt-0.5">{gallery.clientName}</p>
          )}
          <a
            href={`/gallery/${gallery.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-brand-primary"
          >
            /gallery/{gallery.slug} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={busy}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold border ${
              gallery.isActive
                ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/10"
                : "border-brand-border text-text-secondary bg-brand-surface"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {gallery.isActive ? "Active" : "Inactive"}
          </button>
          <button
            type="button"
            onClick={handleDeleteGallery}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <UploadPanel
        galleryId={gallery.id}
        onUploaded={loadImages}
        onDone={() => {
          // Refresh the count and scroll the freshly uploaded photos into view.
          void loadImages();
          galleryGridRef.current?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      <div ref={galleryGridRef}>
        <h2 className="text-sm font-semibold text-text-secondary mb-2">
          {gallery.imageCount} photo{gallery.imageCount === 1 ? "" : "s"}
        </h2>
        {loading ? (
          <p className="text-sm text-text-secondary">Loading photos…</p>
        ) : images.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No photos yet — tap &ldquo;Add photos&rdquo; above to upload your first batch.
          </p>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.folder?.id ?? "unfiled"}>
                {(group.folder || folders.length > 0) && (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-text-primary">
                      {group.folder?.name ?? "Unfiled"}
                      <span className="ml-1.5 font-normal text-text-secondary">
                        {group.items.length} photo
                        {group.items.length === 1 ? "" : "s"}
                      </span>
                    </h3>
                    {group.folder && (
                      <span className="flex items-center gap-2 text-[11px] text-text-secondary">
                        {group.folder.coverPhotoId ? (
                          <>
                            <span className="flex items-center gap-1 text-amber-300">
                              <Star className="h-3 w-3 fill-amber-300" /> Custom cover
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleSetFolderCover(group.folder!.id, null)
                              }
                              disabled={busy}
                              className="rounded-full border border-brand-border px-2 py-0.5 font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40"
                            >
                              Clear
                            </button>
                          </>
                        ) : (
                          "Cover: first photo"
                        )}
                      </span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {group.items.map((img) => (
                    <ImageCard
                      key={img.id}
                      image={img}
                      isCover={img.id === coverImageId}
                      isFolderCover={
                        group.folder != null &&
                        group.folder.coverPhotoId === img.id
                      }
                      onSetCover={handleSetCover}
                      onSetFolderCover={
                        group.folder
                          ? (imageId) =>
                              handleSetFolderCover(group.folder!.id, imageId)
                          : undefined
                      }
                      onDeleted={handleImageDeleted}
                      onUpdated={handleImageUpdated}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
