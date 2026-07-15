"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoCard } from "@/components/social/video/VideoCard";
import OnlineNowRow from "./OnlineNowRow";
import type { SocialVideo } from "@/types/social";
import { Compass } from "lucide-react";

// Melori Mirror — the TikTok "For You"-style vertical feed.
//
// Motion design (reworked 2026-07-15 after a diagnosis + independent KIMI
// review of "moves funny" — twitchy, snap-back, wrong video):
//   - The "online now" ring row is the FIRST snap section but is NO LONGER a
//     nested vertical scroller. A nested `overflow-y` scroller inside a
//     scroll-snap container corrupts the snap algorithm (half-snap/jump). The
//     row now scrolls only horizontally; the section itself is a plain
//     full-height snap item that never scrolls vertically on its own.
//   - Active-card tracking is computed DETERMINISTICALLY from the container's
//     scrollTop (round(scrollTop / cardHeight)), throttled with rAF — instead
//     of a "set-only" IntersectionObserver that never cleared and let two
//     adjacent cards fight over activeIndex. This removes the observer→state
//     race that caused the twitch and the wrong video playing.
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
  // Start at 0 so the first video plays immediately on load (the scroller opens
  // on it). The scroll listener keeps this in sync as the user moves.
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Active-card tracking, computed deterministically from scroll position.
  //
  // The snap scroller now contains ONLY the video cards (the online-now strip
  // is a fixed header above it, not a snap page), and each card is exactly one
  // scroller-viewport tall, so the active index is simply:
  //   round(scrollTop / viewportHeight)
  // A single rAF-throttled passive scroll listener keeps this cheap and avoids
  // the multi-fire observer races that made the feed twitch.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const compute = () => {
      rafRef.current = null;
      const vh = container.clientHeight || 1;
      const page = Math.round(container.scrollTop / vh);
      const clamped = Math.max(0, Math.min(page, videos.length - 1));
      setActiveIndex((prev) => (prev === clamped ? prev : clamped));
    };

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(compute);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    // Compute once on mount / when the list length changes.
    compute();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [videos.length]);

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
    // Outer column fills the visible viewport (100dvh minus the 4rem header).
    // Row 1: a COMPACT online-now strip (auto height, not a full screen).
    // Row 2: the video snap-scroller, which takes all remaining space and
    // therefore opens ON THE FIRST VIDEO — previously the ring row was its own
    // full-height snap page, so the feed opened on an near-empty screen and you
    // had to scroll a whole viewport to see any content.
    <div
      // Fill the space BETWEEN the fixed header (top, 4rem) and the fixed
      // bottom bars. On mobile those are the audio player stacked above the
      // tab bar (matches the root layout's mobile `pb-44` = 11rem); on desktop
      // only the player is fixed (`md:pb-24` = 6rem). We subtract both so a
      // card is exactly the visible area and its bottom isn't hidden behind the
      // bars — that hidden strip is what still looked "a bit too big". `dvh`
      // tracks the mobile URL-bar collapse. Height is set via the
      // `--mirror-bottom` custom property so it can differ by breakpoint.
      className="mirror-viewport absolute inset-x-0 top-0 flex w-full flex-col bg-melori-void"
    >
      {/* Compact live strip. Fixed, shrink-0, scrolls only horizontally. */}
      <div className="shrink-0">
        <OnlineNowRow />
      </div>

      {videos.length === 0 ? (
        // Empty feed state (social_videos has no rows yet) — fills the space
        // below the strip so Mirror never shows a blank screen.
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
      ) : (
        // The snap scroller: only video cards, each exactly one scroller
        // viewport tall, so it opens on the first video and stops cleanly.
        <div
          ref={containerRef}
          className="video-snap hide-scrollbar min-h-0 flex-1 overflow-y-scroll"
        >
          {videos.map((video, index) => (
            <div
              key={video.id}
              data-index={index}
              className="mirror-video-item video-snap-item relative h-full w-full flex-shrink-0 overflow-hidden"
            >
              <VideoCard
                video={video}
                isActive={index === activeIndex}
                distance={Math.abs(index - activeIndex)}
              />
            </div>
          ))}

          {cursor && <div ref={sentinelRef} className="h-4 w-full" />}
        </div>
      )}
    </div>
  );
}
