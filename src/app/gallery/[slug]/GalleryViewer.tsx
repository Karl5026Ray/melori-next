"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Download,
  Camera,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Share2,
  Trash2,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { folderShareKeys, FOLDER_QUERY_PARAM } from "./share";
import {
  OwnerBar,
  deletePhoto,
  downloadOriginal,
  useGalleryOwner,
} from "./OwnerTools";

export interface ViewerImage {
  id: string;
  folderId: string | null;
  previewUrl: string;
  thumbnailUrl: string;
  blurHash: string | null;
  caption: string | null;
  filename: string | null;
}

export interface ViewerFolder {
  id: string;
  name: string;
  coverPhotoId: string | null;
}

// Last-resort copy for browsers without the async clipboard API (older iOS
// Safari, non-secure contexts). Returns whether the copy succeeded.
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.className = "pointer-events-none fixed -left-full top-0 opacity-0";
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export default function GalleryViewer({
  galleryId,
  ownerId,
  gallerySlug,
  galleryName,
  clientName,
  allowDownloads,
  folders,
  images,
  initialFolder,
}: {
  galleryId: string;
  ownerId: string;
  gallerySlug: string;
  galleryName: string;
  clientName: string | null;
  allowDownloads: boolean;
  folders: ViewerFolder[];
  images: ViewerImage[];
  initialFolder: string | null;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [shareState, setShareState] = useState<{
    key: string;
    copied: boolean;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shareTimerRef = useRef<number | null>(null);

  const router = useRouter();
  const isOwner = useGalleryOwner(ownerId);
  // Owner upload panel: undefined = closed, null = no folder, else folder id.
  const [uploadTarget, setUploadTarget] = useState<string | null | undefined>(
    undefined,
  );
  const ownerBarRef = useRef<HTMLDivElement | null>(null);
  // Photos the owner just deleted, hidden at once while the page refreshes.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The owner can always pull originals; visitors only when downloads are on.
  const canDownload = allowDownloads || isOwner;

  async function handleDownload(imageId: string) {
    setBusyId(imageId);
    const err = await downloadOriginal(gallerySlug, imageId);
    setBusyId(null);
    if (err) setNotice(err);
  }

  async function handleDelete(img: ViewerImage) {
    if (
      !window.confirm(
        `Delete ${img.filename ?? "this photo"}? The full-resolution original is removed too. This can't be undone.`,
      )
    )
      return;
    setBusyId(img.id);
    const err = await deletePhoto(img.id);
    setBusyId(null);
    if (err) {
      setNotice(err);
      return;
    }
    setActiveIndex(null);
    setRemoved((prev) => new Set(prev).add(img.id));
    router.refresh();
  }

  function addPhotosTo(folderKey: string) {
    setUploadTarget(folderKey === "unfiled" ? null : folderKey);
    requestAnimationFrame(() =>
      ownerBarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Group images by folder, preserving order. Images without a folder land in
  // an implicit "Gallery" group rendered first.
  const groups = useMemo(() => {
    const byFolder = new Map<string | null, ViewerImage[]>();
    for (const img of images) {
      if (removed.has(img.id)) continue;
      const key = img.folderId;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(img);
    }
    const result: {
      key: string;
      name: string;
      items: ViewerImage[];
      cover: ViewerImage;
    }[] = [];
    const unfiled = byFolder.get(null);
    if (unfiled?.length)
      result.push({
        key: "unfiled",
        name: "Gallery",
        items: unfiled,
        cover: unfiled[0],
      });
    for (const folder of folders) {
      const items = byFolder.get(folder.id);
      if (!items?.length) continue;
      const chosen = folder.coverPhotoId
        ? items.find((img) => img.id === folder.coverPhotoId)
        : undefined;
      result.push({
        key: folder.id,
        name: folder.name,
        items,
        cover: chosen ?? items[0],
      });
    }
    const shareKeys = folderShareKeys(result);
    return result.map((group) => ({
      ...group,
      shareKey: shareKeys.get(group.key)!,
    }));
  }, [images, folders, removed]);

  // A `?folder=` deep link opens the matching group on load; anything we can't
  // match just falls through to the normal collapsed view.
  const [openKey, setOpenKey] = useState<string | null>(
    () =>
      groups.find(
        (g) => g.shareKey === initialFolder || g.key === initialFolder,
      )?.key ?? null,
  );

  const openGroup = groups.find((g) => g.key === openKey) ?? null;

  // Keep the last opened group mounted so the panel can animate closed instead
  // of vanishing the instant its content unmounts.
  const lastOpenRef = useRef(openGroup);
  if (openGroup) lastOpenRef.current = openGroup;
  const panelGroup = openGroup ?? lastOpenRef.current;

  const lightboxItems = panelGroup?.items ?? [];
  const active = activeIndex !== null ? (lightboxItems[activeIndex] ?? null) : null;

  // A deep-linked folder scrolls into view on every viewport, once. Ordinary
  // taps only scroll on narrow screens, where the panel opens below the fold.
  const deepLinkScrollRef = useRef(openKey !== null);
  useEffect(() => {
    if (!openKey) return;
    const fromDeepLink = deepLinkScrollRef.current;
    deepLinkScrollRef.current = false;
    const frame = requestAnimationFrame(() => {
      if (fromDeepLink || window.innerWidth < 640) {
        panelRef.current?.scrollIntoView({
          behavior: fromDeepLink ? "auto" : "smooth",
          block: "start",
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [openKey]);

  // Keep the address bar in sync with the open folder so the page can always be
  // shared or reloaded as-is. replaceState avoids a navigation (and the RSC
  // refetch a router.replace would trigger on this force-dynamic route).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openGroup) url.searchParams.set(FOLDER_QUERY_PARAM, openGroup.shareKey);
    else url.searchParams.delete(FOLDER_QUERY_PARAM);
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, "", next);
  }, [openGroup]);

  useEffect(
    () => () => {
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
    },
    [],
  );

  function toggleGroup(key: string) {
    setActiveIndex(null);
    setOpenKey((current) => (current === key ? null : key));
  }

  function flashShareResult(key: string, copied: boolean) {
    setShareState({ key, copied });
    if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
    shareTimerRef.current = window.setTimeout(() => setShareState(null), 1800);
  }

  async function shareGroup(group: {
    key: string;
    name: string;
    shareKey: string;
  }) {
    const url = `${SITE_URL}/gallery/${gallerySlug}?${FOLDER_QUERY_PARAM}=${encodeURIComponent(
      group.shareKey,
    )}`;
    const title = `${group.name} · ${galleryName}`;

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text: title, url });
        return;
      }
    } catch (err) {
      // AbortError = the visitor dismissed the share sheet; not a failure, and
      // no reason to fall back to the clipboard behind their back.
      if (err instanceof Error && err.name === "AbortError") return;
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        flashShareResult(group.key, true);
        return;
      }
    } catch {
      // Clipboard permission denied — try the legacy path below.
    }

    flashShareResult(group.key, legacyCopy(url));
  }

  function showNext(dir: 1 | -1) {
    setActiveIndex((i) => {
      if (i === null) return i;
      const next = i + dir;
      if (next < 0 || next >= lightboxItems.length) return i;
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-brand-background text-text-primary">
      <header className="border-b border-brand-border px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {galleryName}
              </h1>
              <p className="text-sm text-text-secondary">
                {clientName ? `${clientName} · ` : ""}
                {images.length} photo{images.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          {isOwner && (
            <div ref={ownerBarRef} className="scroll-mt-4">
              <OwnerBar
                galleryId={galleryId}
                folders={folders}
                allowDownloads={allowDownloads}
                uploadTarget={uploadTarget}
                setUploadTarget={setUploadTarget}
              />
            </div>
          )}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-full bg-brand-surface px-4 py-2 text-sm font-semibold text-text-primary shadow-lg"
        >
          {notice}
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {images.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-surface p-8 text-center text-text-secondary">
            This gallery has no photos yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {groups.map((group) => {
                const isOpen = group.key === openKey;
                return (
                  <div
                    key={group.key}
                    className={`group relative overflow-hidden rounded-xl border bg-brand-surface transition-colors ${
                      isOpen
                        ? "border-brand-primary"
                        : "border-brand-border hover:border-brand-primary"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={isOpen}
                      aria-controls="gallery-category-panel"
                      className="block w-full text-left"
                    >
                      <div className="relative aspect-square overflow-hidden bg-brand-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={group.cover.thumbnailUrl}
                          alt={group.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand-background/80 text-text-primary">
                          <ChevronDown
                            className={`h-4 w-4 transition-transform duration-300 ${
                              isOpen ? "rotate-180" : ""
                            }`}
                          />
                        </span>
                      </div>
                      <div className="p-3">
                        <p className="truncate text-sm font-semibold">
                          {group.name}
                        </p>
                        <p className="mt-0.5 text-xs text-text-secondary">
                          {group.items.length} photo
                          {group.items.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        shareGroup(group);
                      }}
                      aria-label={`Share ${group.name}`}
                      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-background/80 text-text-primary transition-colors hover:bg-brand-background focus-visible:ring-2 focus-visible:ring-brand-primary"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                    {shareState?.key === group.key && (
                      <span
                        role="status"
                        className="pointer-events-none absolute right-2 top-11 rounded-full bg-brand-background/90 px-2 py-1 text-[10px] font-semibold text-text-primary"
                      >
                        {shareState.copied ? "Link copied" : "Copy failed"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              id="gallery-category-panel"
              ref={panelRef}
              inert={!openGroup}
              className={`grid transition-all duration-300 ease-out ${
                openGroup
                  ? "mt-6 grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                {panelGroup && (
                  <section aria-label={panelGroup.name}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2 className="text-lg font-semibold text-text-primary">
                        {panelGroup.name}
                      </h2>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => addPhotosTo(panelGroup.key)}
                            className="flex items-center gap-1.5 rounded-full bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add photos here
                          </button>
                        )}
                        {shareState?.key === panelGroup.key && (
                          <span
                            role="status"
                            className="text-xs font-semibold text-text-secondary"
                          >
                            {shareState.copied ? "Link copied" : "Copy failed"}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => shareGroup(panelGroup)}
                          aria-label={`Share ${panelGroup.name}`}
                          className="flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-brand-primary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-brand-primary"
                        >
                          <Share2 className="h-3.5 w-3.5" /> Share
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleGroup(panelGroup.key)}
                          className="flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-brand-primary hover:text-text-primary"
                        >
                          <X className="h-3.5 w-3.5" /> Close
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {panelGroup.items.map((img, idx) => (
                        <figure
                          key={img.id}
                          className="group relative overflow-hidden rounded-xl border border-brand-border bg-brand-surface"
                        >
                          <button
                            type="button"
                            onClick={() => setActiveIndex(idx)}
                            className="relative block aspect-square w-full overflow-hidden"
                            aria-label={`Open ${img.filename ?? "photo"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.thumbnailUrl}
                              alt={img.caption ?? img.filename ?? "Gallery photo"}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          </button>
                          {canDownload ? (
                            <button
                              type="button"
                              onClick={() => handleDownload(img.id)}
                              disabled={busyId === img.id}
                              aria-label={`Download full resolution ${img.filename ?? "photo"}`}
                              className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-brand-background/85 px-2 py-1 text-[10px] font-semibold text-text-primary transition-opacity hover:bg-brand-background disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                            >
                              <Download className="h-3 w-3" /> Full res
                            </button>
                          ) : null}
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => handleDelete(img)}
                              disabled={busyId === img.id}
                              aria-label={`Delete ${img.filename ?? "photo"}`}
                              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-background/85 text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </figure>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-brand-background/95 p-4 backdrop-blur"
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveIndex(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setActiveIndex(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-surface text-text-primary transition-colors hover:bg-brand-muted"
          >
            <X className="h-5 w-5" />
          </button>

          {activeIndex !== null && activeIndex > 0 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => {
                e.stopPropagation();
                showNext(-1);
              }}
              className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-brand-surface text-text-primary transition-colors hover:bg-brand-muted"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {activeIndex !== null && activeIndex < lightboxItems.length - 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => {
                e.stopPropagation();
                showNext(1);
              }}
              className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-brand-surface text-text-primary transition-colors hover:bg-brand-muted"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          <div
            className="flex max-h-[90vh] max-w-[92vw] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.previewUrl}
              alt={active.caption ?? active.filename ?? "Gallery photo"}
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {active.caption && (
                <p className="text-sm text-text-secondary">{active.caption}</p>
              )}
              {canDownload && (
                <button
                  type="button"
                  onClick={() => handleDownload(active.id)}
                  disabled={busyId === active.id}
                  className="flex items-center gap-1.5 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {busyId === active.id ? "Preparing…" : "Download full resolution"}
                </button>
              )}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => handleDelete(active)}
                  disabled={busyId === active.id}
                  className="flex items-center gap-1.5 rounded-full border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
