"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoCard } from "@/components/social/video/VideoCard";
import OnlineNowRow from "./OnlineNowRow";
import type { SocialVideo } from "@/types/social";
import { Compass } from "lucide-react";

// Melori Mirror — the TikTok "For You"-style vertical feed.
//
// Design (validated against the Kimi feed-architecture chat + an independent
// architecture review):
//   - The "online now" ring row is the FIRST snap section INSIDE the vertical
//     scroll container (not a position:sticky header — sticky inside a
//     scroll-snap scroller half-snaps cards on iOS). It scroll-snaps to the
//     top, then video cards follow as full-height snap items.
//   - Reuses the same IntersectionObserver active-index pattern as VideoFeed so
//     only the on-screen card plays.
//   - Keyset infinite scroll via /api/mirror/feed (?cursor=created_at_id).
export default function MirrorFeed({
  initialVideos,
  initialCursor,
}: {
  initialVideos: SocialVideo[];
  initialCursor: string | null;
}) {
  const [videos, setVideos] = useState<SocialVideo[]>(initialVideos);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Active-card tracking: play only the card that is >=60% on screen.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute("data-index"));
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        });
      },
      { root: container, threshold: 0.6 },
    );

    const children = container.querySelectorAll(".mirror-video-item");
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [videos]);

  // Keyset infinite scroll — load the next page when the sentinel appears.
  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/mirror/feed?cursor=${encodeURIComponent(cursor)}&limit=10`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data: { items?: SocialVideo[]; nextCursor?: string | null } =
          await res.json();
        setVideos((prev) => [...prev, ...(data.items ?? [])]);
        setCursor(data.nextCursor ?? null);
      }
    } catch {
      /* transient — the sentinel will retry on next scroll */
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  useEffect(() => {
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: container, rootMargin: "600px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-scroll video-snap hide-scrollbar bg-melori-void"
    >
      {/* First snap section: the online-now ring row + a title. */}
      <section className="video-snap-item flex min-h-full w-full flex-col">
        <OnlineNowRow />
        {videos.length === 0 && (
          // Empty feed state (social_videos has no rows yet). Mirror still feels
          // alive thanks to the live ring row above; here we invite the first
          // post rather than showing a blank screen.
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-melori-elevated">
              <Compass className="h-10 w-10 text-melori-muted" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-white">
              Mirror is warming up
            </h3>
            <p className="mb-6 max-w-sm text-melori-muted">
              Melori Mirror shows what&apos;s happening on Melori right now.
              Tap a ring above to join someone live, or post the first Mirror
              video.
            </p>
            <Link
              href="/social/video"
              className="rounded-xl bg-brand-primary px-5 py-2.5 font-semibold text-white transition-opacity hover:opacity-90"
            >
              Post the first video
            </Link>
          </div>
        )}
      </section>

      {/* Full-height video snap items. */}
      {videos.map((video, index) => (
        <div
          key={video.id}
          data-index={index}
          className="mirror-video-item video-snap-item relative h-full w-full flex-shrink-0"
        >
          <VideoCard video={video} isActive={index === activeIndex} />
        </div>
      ))}

      {cursor && <div ref={sentinelRef} className="h-4 w-full" />}
    </div>
  );
}
