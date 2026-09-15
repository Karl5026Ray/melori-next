// Which stage a Mirror post plays on.
//
// Every native post used to render inside a fixed 9:16 portrait stage. A
// landscape clip fitted into that stage fills only its *width* and leaves
// thick black bars above and below — small enough that it reads as broken.
// Posted lives were the worst case: a LiveKit RoomComposite is rendered
// landscape (the default 720p preset is 1280x720), so every live published to
// the Mirror came out as a thin letterboxed strip.
//
// Orientation is measured once, in the browser, at publish time and stored on
// social_videos.is_vertical. `null` means "never measured" — every post made
// before this existed — and keeps the original portrait stage, so nothing
// already in the feed moves.
//
// Scope: this covers the native <video> stage only. The YouTube branch renders
// an iframe and keeps its own fill treatment.

export type Orientation = boolean | null | undefined;

export const PORTRAIT_STAGE = "relative aspect-[9/16] h-full max-w-full";
export const LANDSCAPE_STAGE = "relative aspect-video w-full max-h-full";

/**
 * Orientation of a decoded clip.
 *
 * Square counts as vertical: it fills a 9:16 stage far better than a 16:9 one.
 * Returns null when either dimension is missing, zero or negative, so a clip
 * whose metadata could not be read publishes unmarked rather than guessed.
 */
export function isVerticalFromDimensions(
  width: number | null | undefined,
  height: number | null | undefined,
): boolean | null {
  if (!width || !height) return null;
  if (width <= 0 || height <= 0) return null;
  return height >= width;
}

/** Tailwind classes for the stage a clip of this orientation plays on. */
export function stageClassName(isVertical: Orientation): string {
  return isVertical === false ? LANDSCAPE_STAGE : PORTRAIT_STAGE;
}
