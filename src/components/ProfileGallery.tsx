"use client";

import { useEffect, useState } from "react";

// Public "Photos" section rendered on artist pages and social profiles.
// Fetches the profile's gallery from the public read route and renders a
// responsive grid with a simple tap-to-enlarge lightbox. Renders nothing when
// the profile has no photos, so callers can drop it in unconditionally.

type Photo = { id: string; image_url: string; sort_order: number };

export default function ProfileGallery({
  profileId,
  heading = "Photos",
  className = "",
}: {
  profileId: string | null | undefined;
  heading?: string;
  className?: string;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setPhotos([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/profiles/${profileId}/gallery`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { photos: rows } = (await res.json()) as { photos: Photo[] };
        if (!cancelled) setPhotos(Array.isArray(rows) ? rows : []);
      } catch {
        /* ignore — section simply stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!profileId || photos.length === 0) return null;

  return (
    <section className={className}>
      <h2 className="mb-4 text-2xl font-bold">{heading}</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.image_url)}
            className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.image_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active}
            alt=""
            className="max-h-full max-w-full rounded-2xl object-contain"
          />
          <button
            type="button"
            onClick={() => setActive(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
