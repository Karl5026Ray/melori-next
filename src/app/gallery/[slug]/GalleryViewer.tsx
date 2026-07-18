"use client";

import { useMemo, useState } from "react";
import { X, ShoppingBag, Download, Camera, ChevronLeft, ChevronRight } from "lucide-react";

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

  // Group images by folder, preserving order. Images without a folder land in
  // an implicit "Gallery" group rendered first.
  const groups = useMemo(() => {
    const byFolder = new Map<string | null, ViewerImage[]>();
    for (const img of images) {
      const key = img.folderId;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(img);
    }
    const result: { title: string | null; items: ViewerImage[] }[] = [];
    const unfiled = byFolder.get(null);
    if (unfiled?.length) result.push({ title: null, items: unfiled });
    for (const folder of folders) {
      const items = byFolder.get(folder.id);
      if (items?.length) result.push({ title: folder.name, items });
    }
    return result;
  }, [images, folders]);

  const active = activeIndex !== null ? images[activeIndex] : null;

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
      if (next < 0 || next >= images.length) return i;
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
          groups.map((group, gi) => (
            <section key={group.title ?? `group-${gi}`} className="mb-10">
              {group.title && (
                <h2 className="mb-4 text-lg font-semibold text-text-primary">
                  {group.title}
                </h2>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {group.items.map((img) => {
                  const idx = images.findIndex((x) => x.id === img.id);
                  return (
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
                            : `Buy ${formatPrice(img.priceCents)}`}
                        </button>
                      ) : allowDownloads ? (
                        <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-brand-background/80 px-2 py-1 text-[10px] font-semibold text-text-secondary opacity-0 transition-opacity group-hover:opacity-100">
                          <Download className="h-3 w-3" /> Download
                        </span>
                      ) : null}
                    </figure>
                  );
                })}
              </div>
            </section>
          ))
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
          {activeIndex !== null && activeIndex < images.length - 1 && (
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
                    : `Buy — ${formatPrice(active.priceCents)}`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
