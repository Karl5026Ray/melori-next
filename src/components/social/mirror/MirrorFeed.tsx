"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoCard } from "@/components/social/video/VideoCard";
import OnlineNowRow from "./OnlineNowRow";
import type { SocialVideo } from "@/types/social";
import {
  canClearManualNavigationGuard,
  getMirrorPlaybackEndAdvance,
  MANUAL_NAVIGATION_IDLE_MS,
  releaseManualNavigationGuard,
  refreshManualNavigationGuard,
  type ManualNavigationGuard,
} from "@/lib/mirrorFeedNavigation";
import { Compass, MessagesSquare } from "lucide-react";

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
  // Refs let a late media `ended` event verify that its card is still current
  // before moving the feed. That preserves a user's manual swipe/navigation.
  const videosRef = useRef(videos);
  const activeIndexRef = useRef(activeIndex);
  const completionInFlightRef = useRef<string | null>(null);
  // Manual navigation is detected before React's state update commits. A
  // completion from the departing card must never win that race and pull the
  // viewer into an autoplay scroll they did not ask for.
  const manualNavigationRef = useRef<ManualNavigationGuard | null>(null);
  const manualNavigationTimerRef = useRef<number | null>(null);
  const automaticScrollTargetRef = useRef<number | null>(null);
  const pointerStartYRef = useRef<number | null>(null);

  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    // A fresh card may complete during the next trip through the feed. Keep
    // the previous completion latched only while its source card remains the
    // active one, so duplicate browser/iframe end events cannot chain-advance.
    if (videos[activeIndex]?.id !== completionInFlightRef.current) {
      completionInFlightRef.current = null;
    }
  }, [activeIndex, videos]);

  const clearManualNavigationTimer = useCallback(() => {
    if (manualNavigationTimerRef.current !== null) {
      clearTimeout(manualNavigationTimerRef.current);
      manualNavigationTimerRef.current = null;
    }
  }, []);

  const scheduleManualNavigationClear = useCallback(() => {
    const guard = manualNavigationRef.current;
    if (!guard) return;

    clearManualNavigationTimer();
    const expectedActivityAt = guard.lastActivityAt;
    manualNavigationTimerRef.current = window.setTimeout(() => {
      manualNavigationTimerRef.current = null;
      const current = manualNavigationRef.current;
      if (!current || current.lastActivityAt !== expectedActivityAt) return;
      if (canClearManualNavigationGuard(current, Date.now())) {
        manualNavigationRef.current = null;
      }
    }, MANUAL_NAVIGATION_IDLE_MS);
  }, [clearManualNavigationTimer]);

  const markManualNavigationIntent = useCallback((pointerActive?: boolean) => {
    manualNavigationRef.current = refreshManualNavigationGuard(
      manualNavigationRef.current,
      pointerActive,
      Date.now(),
    );
    // A direct touch/drag/wheel input supersedes any in-progress autoplay
    // animation immediately, before scroll-state effects run.
    automaticScrollTargetRef.current = null;
    scheduleManualNavigationClear();
  }, [scheduleManualNavigationClear]);

  const finishManualPointer = useCallback(() => {
    pointerStartYRef.current = null;
    const guard = manualNavigationRef.current;
    if (!guard) return;
    manualNavigationRef.current = releaseManualNavigationGuard(guard, Date.now());
    scheduleManualNavigationClear();
  }, [scheduleManualNavigationClear]);

  const clearSettledManualNavigation = useCallback(() => {
    const guard = manualNavigationRef.current;
    if (!guard || guard.pointerActive) return;
    clearManualNavigationTimer();
    manualNavigationRef.current = null;
  }, [clearManualNavigationTimer]);

  // Timers are intentionally ref-owned: media completion callbacks can outlive
  // a render, and this cleanup prevents a completed timer from changing guard
  // state after the feed unmounts.
  useEffect(() => clearManualNavigationTimer, [clearManualNavigationTimer]);

  // Advance inside the currently loaded sequence only. In particular, wrapping
  // from the last post to the first must not invoke pagination or duplicate any
  // items; loading more remains owned exclusively by the sentinel below.
  const handlePlaybackEnded = useCallback((videoId: string) => {
    const currentVideos = videosRef.current;
    const currentIndex = activeIndexRef.current;
    const container = containerRef.current;
    const advance = getMirrorPlaybackEndAdvance({
      videoId,
      activeVideoId: currentVideos[currentIndex]?.id,
      activeIndex: currentIndex,
      itemCount: currentVideos.length,
      pageHeight: container?.clientHeight ?? 0,
      manualNavigationInProgress: manualNavigationRef.current !== null,
      completionInFlightVideoId: completionInFlightRef.current,
    });
    if (!advance) return;

    // Set the ref synchronously before requesting the scroll. A browser can
    // emit more than one end-state message while the smooth wrap is beginning;
    // those duplicate signals then fail the current-card guard above.
    completionInFlightRef.current = videoId;
    automaticScrollTargetRef.current = advance.nextIndex;
    activeIndexRef.current = advance.nextIndex;
    setActiveIndex(advance.nextIndex);

    if (container && advance.scrollTop !== null) {
      container.scrollTo({ top: advance.scrollTop, behavior: "smooth" });
    }
  }, []);

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

    const currentPage = () => {
      const vh = container.clientHeight || 1;
      const page = Math.round(container.scrollTop / vh);
      return Math.max(0, Math.min(page, videos.length - 1));
    };

    const synchronizeNavigationRef = () => {
      const clamped = currentPage();
      const automaticTarget = automaticScrollTargetRef.current;

      if (automaticTarget !== null) {
        if (clamped === automaticTarget) {
          automaticScrollTargetRef.current = null;
        }
        return;
      }

      if (clamped !== activeIndexRef.current) {
        markManualNavigationIntent();
        activeIndexRef.current = clamped;
      } else if (manualNavigationRef.current) {
        // A boundary wheel or snap-back can emit scroll without changing the
        // page. It is still manual activity, so extend the quiet-window guard.
        markManualNavigationIntent();
      }
    };

    const compute = () => {
      rafRef.current = null;
      const clamped = currentPage();

      // Do not let rAF samples from an automatic smooth scroll reactivate
      // intermediate/old cards. A genuine touch/drag/wheel clears this target
      // synchronously, so manual navigation continues through the normal path.
      if (automaticScrollTargetRef.current !== null) return;
      setActiveIndex((prev) => (prev === clamped ? prev : clamped));
    };

    const onScroll = () => {
      // This runs in the scroll event itself, not the later rAF state update.
      // It closes the stale-ended-event window during a manual swipe.
      synchronizeNavigationRef();
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(compute);
    };
    const onScrollEnd = () => {
      // `scrollend` is the strongest available signal that momentum is over.
      // Browsers without it retain the conservative inactivity timer instead.
      clearSettledManualNavigation();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("scrollend", onScrollEnd);
    // Compute once on mount / when the list length changes.
    compute();
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("scrollend", onScrollEnd);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    videos.length,
    clearSettledManualNavigation,
    markManualNavigationIntent,
  ]);

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
      // bottom chrome. `--mirror-bottom` is the shared tab-bar + default
      // floating-transport clearance on mobile and the full player height on
      // desktop, so a card remains wholly visible while `dvh` tracks URL-bar
      // collapse.
      className="mirror-viewport absolute inset-x-0 top-0 flex w-full flex-col bg-melori-void"
    >
      {/* Compact live strip. Fixed, shrink-0, scrolls only horizontally. */}
      <div className="shrink-0">
        <OnlineNowRow />
      </div>

      {/* Community lives INSIDE the Mirror now (moved off the side nav). A
          floating pill on the top-left keeps the right edge clear for each
          card's mute toggle. z-30 sits above the video but below any modal. */}
      <Link
        href="/social/community"
        aria-label="Community"
        className="absolute left-3 top-16 z-30 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition-opacity hover:opacity-90"
      >
        <MessagesSquare className="h-4 w-4" />
        Community
      </Link>

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
          onPointerDown={(event) => {
            if (!event.isPrimary) return;
            pointerStartYRef.current = event.clientY;
            // Keep the release/cancel lifecycle on this scroll container even
            // when a swipe leaves its bounds, so pointerActive cannot latch.
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const startY = pointerStartYRef.current;
            if (
              event.isPrimary &&
              startY !== null &&
              Math.abs(event.clientY - startY) > 8
            ) {
              markManualNavigationIntent(true);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            finishManualPointer();
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            finishManualPointer();
          }}
          onWheel={() => markManualNavigationIntent(false)}
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
                shouldLoop={videos.length === 1}
                onPlaybackEnded={handlePlaybackEnded}
                onDeleted={(id) =>
                  setVideos((prev) => prev.filter((v) => v.id !== id))
                }
              />
            </div>
          ))}

          {cursor && <div ref={sentinelRef} className="h-4 w-full" />}
        </div>
      )}
    </div>
  );
}
