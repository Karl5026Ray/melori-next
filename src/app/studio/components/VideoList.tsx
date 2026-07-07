"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/authClient";

interface StudioVideo {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  user_id: string;
  created_at: string;
}

// Studio-side listing of the artist's own social videos. Shows the video with
// its title/description and a Delete button. The public /api/social/videos
// route already returns every video (it's a public feed), so we filter to the
// caller's uid on the client — the DELETE route re-enforces ownership server
// side, so this filter is just presentation, not a security boundary.
export default function VideoList({ userId }: { userId: string | null }) {
  const [videos, setVideos] = useState<StudioVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    try {
      // Public endpoint — no auth needed for the read; caller-side filter
      // limits the list to this artist's rows for the Studio UI.
      const res = await fetch("/api/social/videos", { cache: "no-store" });
      if (!res.ok) {
        setVideos([]);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const all = (body?.videos ?? []) as StudioVideo[];
      setVideos(userId ? all.filter((v) => v.user_id === userId) : []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  const deleteVideo = useCallback(
    async (id: string, title: string) => {
      if (
        !window.confirm(
          `Delete video "${title}" permanently? This removes the video file and any thumbnail. This cannot be undone.`,
        )
      ) {
        return;
      }
      setDeletingId(id);
      try {
        const res = await authFetch(`/api/social/videos/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          window.alert(err?.error ?? "Failed to delete video.");
          return;
        }
        setVideos((prev) => prev.filter((v) => v.id !== id));
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="mt-8 text-center text-sm text-[#888]">
        Loading your videos…
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
        <p className="text-3xl mb-2">🎬</p>
        <p className="text-sm text-[#888]">
          No videos yet. Upload one above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <h3 className="mb-4 text-lg font-semibold">Your Videos</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {videos.map((video) => (
          <div
            key={video.id}
            className="flex flex-col sm:flex-row gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"
          >
            {/* Poster preview. The DOM's own <video> is used so browsers can
                lazily fetch just the first frame — a full thumbnail service is
                overkill for the Studio-side list. On mobile it fills the row
                width so it stays readable; on desktop it stays a compact
                fixed thumbnail beside the metadata. */}
            <video
              src={video.video_url}
              poster={video.thumbnail_url ?? undefined}
              muted
              playsInline
              preload="metadata"
              className="aspect-video w-full sm:h-24 sm:w-40 flex-shrink-0 rounded-lg bg-black object-cover"
            />
            <div className="min-w-0 flex-1">
              <h4 className="truncate font-semibold">{video.title}</h4>
              {video.description && (
                <p className="mt-1 line-clamp-2 text-xs text-[#888]">
                  {video.description}
                </p>
              )}
              <div className="mt-3">
                <button
                  onClick={() => deleteVideo(video.id, video.title)}
                  disabled={deletingId === video.id}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-all hover:border-red-500/60 disabled:opacity-50"
                >
                  {deletingId === video.id ? "…" : "🗑 Delete"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
