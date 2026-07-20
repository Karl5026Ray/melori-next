"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Camera, Lock, Plus, Images } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import CreateGalleryModal from "./CreateGalleryModal";
import GalleryDetail from "./GalleryDetail";
import type { GalleryListItem } from "./types";

// /studio/galleries — Phase 1 gallery admin: list, create, and a phone-first
// capture/upload experience per gallery. Client component under StudioGuard.
export default function GalleriesClient() {
  const [galleries, setGalleries] = useState<GalleryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadGalleries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/gallery/list", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load galleries.");
      setGalleries(body.galleries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load galleries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGalleries();
  }, [loadGalleries]);

  const selected = galleries.find((g) => g.id === selectedId) ?? null;

  if (selected) {
    return (
      <div className="min-h-screen bg-brand-background text-text-primary px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-5xl mx-auto">
          <GalleryDetail
            gallery={selected}
            onBack={() => setSelectedId(null)}
            onGalleryChanged={(updated) =>
              setGalleries((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
            }
            onGalleryDeleted={(id) => {
              setGalleries((prev) => prev.filter((g) => g.id !== id));
              setSelectedId(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-background text-text-primary px-4 sm:px-6 py-6 sm:py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
              <Images className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Galleries</h1>
              <p className="text-xs text-text-secondary">
                Create client galleries and upload photos from your phone.
              </p>
            </div>
          </div>
          <Link
            href="/studio"
            className="text-xs text-text-secondary hover:text-brand-primary shrink-0"
          >
            ← Studio
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3.5 text-base font-semibold text-white sm:w-auto sm:px-6"
        >
          <Plus className="h-5 w-5" /> New gallery
        </button>

        {error && (
          <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-text-secondary">Loading galleries…</p>
        ) : galleries.length === 0 ? (
          <div className="mt-8 rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <Camera className="mx-auto h-10 w-10 text-brand-primary" />
            <p className="mt-3 font-semibold">No galleries yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Create your first gallery to start uploading photos.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {galleries.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedId(g.id)}
                className="group overflow-hidden rounded-xl border border-brand-border bg-brand-surface text-left transition-colors hover:border-brand-primary"
              >
                <div className="relative aspect-square overflow-hidden bg-brand-muted">
                  {g.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.coverUrl}
                      alt={g.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-brand-primary">
                      <Camera className="h-8 w-8" />
                    </div>
                  )}
                  {g.hasPassword && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-brand-background/80 px-2 py-1 text-[10px] font-semibold text-text-primary">
                      <Lock className="h-3 w-3" /> Private
                    </span>
                  )}
                  {!g.isActive && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-text-secondary">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{g.name}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {g.clientName ? `${g.clientName} · ` : ""}
                    {g.imageCount} photo{g.imageCount === 1 ? "" : "s"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateGalleryModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await loadGalleries();
          }}
        />
      )}
    </div>
  );
}
