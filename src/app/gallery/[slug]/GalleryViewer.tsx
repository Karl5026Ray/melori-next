"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ShoppingBag,
  Download,
  Camera,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

export interface ViewerImage {
  id: string;
  folderId: string | null;
  previewUrl: string;
  thumbnailUrl: string;
  blurHash: string | null;
  caption: string | null;
  filename: string | null;
  forSale: boolean;
  priceCents: number | null;
}

export interface ViewerFolder {
  id: string;
  name: string;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function GalleryViewer({
  galleryName,
  clientName,
  allowDownloads,
  folders,
  images,
}: {
  galleryName: string;
  clientName: string | null;
  allowDownloads: boolean;
  folders: ViewerFolder[];
  images: ViewerImage[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Group images by folder, preserving order. Images without a folder land in
  // an implicit "Gallery" group rendered first.
  const groups = useMemo(() => {
    const byFolder = new Map<string | null, ViewerImage[]>();
    for (const img of images) {
      const key = img.folderId;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(img);
    }
    const result: { key: string; name: string; items: ViewerImage[] }[] = [];
    const unfiled = byFolder.get(null);
    if (unfiled?.length)
      result.push({ key: "unfiled", name: "Gallery", items: unfiled });
    for (const folder of folders) {
      const items = byFolder.get(folder.id);
      if (items?.length)
        result.push({ key: folder.id, name: folder.name, items });
    }
    return result;
  }, [images, folders]);

  const openGroup = groups.find((g) => g.key === openKey) ?? null;

  // Keep the last opened group mounted so the panel can animate closed instead
  // of vanishing the instant its content unmounts.
  const lastOpenRef = useRef(openGroup);
  if (openGroup) lastOpenRef.current = openGroup;
  const panelGroup = openGroup ?? lastOpenRef.current;

  const lightboxItems = panelGroup?.items ?? [];
  const active = activeIndex !== null ? (lightboxItems[activeIndex] ?? null) : null;

  useEffect(() => {
    if (!openKey) return;
    const frame = requestAnimationFrame(() => {
      if (window.innerWidth < 640) {
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [openKey]);

  function toggleGroup(key: string) {
    setActiveIndex(null);
    setOpenKey((current) => (current === key ? null : key));
  }

  async function buy(imageId: string) {
    setBuyingId(imageId);
    try {
      const res = await fetch("/api/gallery/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url as string;
        return;
      }
      alert(data.error ?? "Could not start checkout.");
    } catch {
      alert("Could not start checkout. Please try again.");
    } finally {
      setBuyingId(null);
    }
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
        </div>
      </header>

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
                const cover = group.items[0];
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={isOpen}
                    aria-controls="gallery-category-panel"
                    className={`group overflow-hidden rounded-xl border bg-brand-surface text-left transition-colors ${
                      isOpen
                        ? "border-brand-primary"
                        : "border-brand-border hover:border-brand-primary"
                    }`}
                  >
                    <div className="relative aspect-square overflow-hidden bg-brand-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cover.thumbnailUrl}
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
                      <button
                        type="button"
                        onClick={() => toggleGroup(panelGroup.key)}
                        className="flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-brand-primary hover:text-text-primary"
                      >
                        <X className="h-3.5 w-3.5" /> Close
                      </button>
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
                          {img.forSale && img.priceCents ? (
                            <button
                              type="button"
                              onClick={() => buy(img.id)}
                              disabled={buyingId === img.id}
                              className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-brand-primary px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-colors hover:bg-brand-primary-dark disabled:opacity-60"
                            >
                              <ShoppingBag className="h-3.5 w-3.5" />
                              {buyingId === img.id
                                ? "…"
                                : `Instant ${formatPrice(img.priceCents)}`}
                            </button>
                          ) : allowDownloads ? (
                            <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-brand-background/80 px-2 py-1 text-[10px] font-semibold text-text-secondary opacity-0 transition-opacity group-hover:opacity-100">
                              <Download className="h-3 w-3" /> Download
                            </span>
                          ) : null}
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
            {/* Watermarked preview only — the clean original is delivered after
                purchase / via the download route. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.previewUrl}
              alt={active.caption ?? active.filename ?? "Gallery photo"}
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />
            <div className="mt-4 flex items-center gap-3">
              {active.caption && (
                <p className="text-sm text-text-secondary">{active.caption}</p>
              )}
              {active.forSale && active.priceCents ? (
                <button
                  type="button"
                  onClick={() => buy(active.id)}
                  disabled={buyingId === active.id}
                  className="flex items-center gap-2 rounded-full bg-brand-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-60"
                >
                  <ShoppingBag className="h-4 w-4" />
                  {buyingId === active.id
                    ? "Starting checkout…"
                    : `Snappd instant — ${formatPrice(active.priceCents)}`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
