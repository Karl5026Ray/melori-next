"use client";

import { Heart, MessageCircle, Play } from "lucide-react";

// A single square media tile used across the profile grids (Reels, Photos,
// Liked, Shared, Saves). Content is polymorphic: a "video" (Mirror reel) shows
// its thumbnail with a play badge; a "photo" shows the gallery image.
export type TileContent = {
  id: string;
  // video fields
  title?: string | null;
  thumbnail_url?: string | null;
  video_url?: string | null;
  comments_count?: number | null;
  // photo fields
  image_url?: string | null;
  // shared
  media_type?: string | null;
  likes_count?: number | null;
};

export default function ProfileContentTile({
  type,
  content,
  onOpen,
}: {
  type: "video" | "photo";
  content: TileContent;
  onOpen?: (content: TileContent, type: "video" | "photo") => void;
}) {
  // A video tile prefers a real poster image (thumbnail_url). When one is
  // missing we must NOT drop the video URL into an <img> — a browser can't
  // decode an .mp4 as an image, so the tile would render blank. Instead we
  // render a muted <video> element that paints its first frame as the poster
  // (preload="metadata" so we don't pull the whole file just to show a grid).
  const imgSrc =
    type === "video" ? content.thumbnail_url || "" : content.image_url || "";
  const videoFallback =
    type === "video" && !content.thumbnail_url
      ? content.video_url || ""
      : "";

  return (
    <button
      type="button"
      onClick={() => onOpen?.(content, type)}
      className="group relative aspect-square overflow-hidden rounded-xl bg-melori-void/60 border border-melori-border"
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={content.title ?? ""}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
      ) : videoFallback ? (
        <video
          src={`${videoFallback}#t=0.1`}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-melori-muted text-xs">
          No preview
        </div>
      )}

      {type === "video" && (
        <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 backdrop-blur">
          <Play className="h-3.5 w-3.5 fill-white text-white" />
        </span>
      )}

      {/* Hover overlay with quick stats */}
      <span className="absolute inset-0 flex items-end justify-start gap-3 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="flex items-center gap-1 text-xs font-semibold text-white">
          <Heart className="h-3.5 w-3.5" />
          {content.likes_count ?? 0}
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-white">
          <MessageCircle className="h-3.5 w-3.5" />
          {content.comments_count ?? 0}
        </span>
      </span>
    </button>
  );
}
