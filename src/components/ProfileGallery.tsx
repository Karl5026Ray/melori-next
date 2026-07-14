"use client";

import { useEffect, useState } from "react";

// Public "Photos" section rendered on artist pages and social profiles.
// Fetches the profile's gallery from the public read route and renders a
// responsive grid with a simple tap-to-enlarge lightbox. Renders nothing when
// the profile has no photos, so callers can drop it in unconditionally.

type Photo = {
  id: string;
  image_url: string;
  media_type?: "photo" | "video";
  sort_order: number;
};

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.image_url)}
            className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-white/5"
          >
            {p.media_type === "video" ? (
              <>
                <video
                  src={p.image_url}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
                    ▶
                  </span>
                </span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image_url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            )}
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
          {/\.(mp4|webm|mov|m4v)(\?|$)/i.test(active) ? (
            <video
              src={active}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full rounded-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={active}
              alt=""
              className="max-h-full max-w-full rounded-2xl object-contain"
            />
          )}
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
