// Navigation rules for the finite, currently-loaded Melori Mirror sequence.
// This intentionally knows nothing about pagination: wrapping is a local UI
// action over items already in memory and must never fetch or append posts.

/**
 * Return the next index after a completed Mirror post.
 *
 * `null` means "stay put": an empty or one-item sequence has no distinct next
 * card to activate. The media element itself handles the one-item loop, which
 * avoids a redundant scroll/play cycle.
 */
export function nextMirrorVideoIndex(
  currentIndex: number,
  itemCount: number,
): number | null {
  if (!Number.isInteger(itemCount) || itemCount <= 1) return null;

  // A stale completion can arrive after manual navigation or a list mutation.
  // Normalize defensively rather than producing an invalid scroll target.
  const normalized = Number.isInteger(currentIndex)
    ? ((currentIndex % itemCount) + itemCount) % itemCount
    : 0;

  return (normalized + 1) % itemCount;
}

/**
 * VideoCard is shared by Mirror and the ordinary VideoFeed. A caller that does
 * not handle completion retains the pre-existing in-place loop; only a feed
 * that explicitly handles completion can turn a multi-item card into a
 * next-card transition.
 */
export function shouldLoopVideoCardMedia(
  shouldLoop: boolean,
  handlesPlaybackEnd: boolean,
): boolean {
  return shouldLoop || !handlesPlaybackEnd;
}

// Scroll momentum can outlive pointerup. Keep the stale-ended-event guard
// through a deliberately quiet window, while `scrollend` clears it earlier
// where the browser provides that definitive signal.
export const MANUAL_NAVIGATION_IDLE_MS = 500;

export interface ManualNavigationGuard {
  pointerActive: boolean;
  lastActivityAt: number;
}

export function refreshManualNavigationGuard(
  current: ManualNavigationGuard | null,
  pointerActive: boolean | undefined,
  now: number,
): ManualNavigationGuard {
  return {
    pointerActive: pointerActive ?? current?.pointerActive ?? false,
    lastActivityAt: now,
  };
}

export function releaseManualNavigationGuard(
  current: ManualNavigationGuard,
  now: number,
): ManualNavigationGuard {
  return { pointerActive: false, lastActivityAt: now };
}

export function canClearManualNavigationGuard(
  current: ManualNavigationGuard,
  now: number,
): boolean {
  return (
    !current.pointerActive &&
    now - current.lastActivityAt >= MANUAL_NAVIGATION_IDLE_MS
  );
}

export interface MirrorPlaybackEndInput {
  videoId: string;
  activeVideoId: string | undefined;
  activeIndex: number;
  itemCount: number;
  pageHeight: number;
  manualNavigationInProgress: boolean;
  completionInFlightVideoId: string | null;
}

export interface MirrorPlaybackAdvance {
  nextIndex: number;
  // `null` means layout has not measured yet. The parent may still activate the
  // next card, but it must not synthesize an invalid scroll position.
  scrollTop: number | null;
}

/**
 * Decide whether one media completion may advance the finite loaded sequence.
 * The result is deliberately a local scroll action: it has no cursor, request,
 * or append operation, so wrapping cannot trigger feed pagination.
 */
export function getMirrorPlaybackEndAdvance(
  input: MirrorPlaybackEndInput,
): MirrorPlaybackAdvance | null {
  if (input.manualNavigationInProgress) return null;
  if (input.activeVideoId !== input.videoId) return null;
  if (input.completionInFlightVideoId === input.videoId) return null;

  const nextIndex = nextMirrorVideoIndex(input.activeIndex, input.itemCount);
  if (nextIndex === null) return null;

  const scrollTop =
    Number.isFinite(input.pageHeight) && input.pageHeight > 0
      ? nextIndex * input.pageHeight
      : null;

  return { nextIndex, scrollTop };
}
