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

// ---------------------------------------------------------------------------
// Endless scroll wrap.
//
// Autoplay already wraps last -> first via nextMirrorVideoIndex(). Manual
// swiping did not: the snap scroller renders exactly `videos.length` cards, so
// once pagination is exhausted the user hits the final card and the feed dead-
// ends. With a filler pool of ~12-16 live items that happens within seconds.
//
// Recycling re-renders the SAME already-loaded items as an additional cycle.
// It issues no request and appends nothing to the feed's data, so it cannot
// duplicate a post server-side or interfere with keyset pagination.
// ---------------------------------------------------------------------------

/** How close to the end the viewer must get before another cycle is appended. */
export const MIRROR_RECYCLE_LOOKAHEAD = 3;

/** Hard ceiling so a feed left open overnight cannot grow DOM without bound. */
export const MIRROR_MAX_RECYCLE_CYCLES = 50;

/**
 * Decide whether the feed should append one more recycled cycle.
 *
 * Only when pagination is finished (`cursor === null`). While a cursor remains,
 * the sentinel keeps loading genuinely new posts and recycling would hide them.
 */
export function shouldAppendMirrorCycle(input: {
  cursor: string | null;
  baseCount: number;
  renderedCount: number;
  activeIndex: number;
  cycles: number;
}): boolean {
  if (input.cursor !== null) return false;
  if (input.baseCount < 2) return false;
  if (input.cycles >= MIRROR_MAX_RECYCLE_CYCLES) return false;
  return input.activeIndex >= input.renderedCount - MIRROR_RECYCLE_LOOKAHEAD;
}

/**
 * Build the rendered sequence: `cycles` repetitions of the loaded items.
 *
 * React keys must stay unique across cycles, so each entry carries a
 * cycle-qualified key while `video.id` stays untouched for playback,
 * completion and delete callbacks.
 */
export function buildMirrorRenderList<T extends { id: string }>(
  items: T[],
  cycles: number,
): { item: T; key: string; cycle: number }[] {
  const safeCycles = Math.max(1, Math.floor(cycles));
  if (items.length === 0) return [];
  const out: { item: T; key: string; cycle: number }[] = [];
  for (let c = 0; c < safeCycles; c += 1) {
    for (const item of items) {
      out.push({ item, key: c === 0 ? item.id : `${item.id}__c${c}`, cycle: c });
    }
  }
  return out;
}
