// Pure logic for deciding whether a MM Faces video TILE should be mirrored on
// screen. Every camera app mirrors the user's own front-camera preview (so it
// matches what they see in a bathroom mirror) but never mirrors the rear
// camera (text/signs in frame would read backwards) and never mirrors a
// REMOTE participant's tile (everyone else must see them the "right" way
// round, exactly as they'd appear on a video call).
//
// This is DISPLAY-ONLY: callers apply the result as a CSS transform
// (`scaleX(-1)`) on the <video> element. The published/encoded LiveKit track
// is never touched, so remote viewers always see the correct, un-mirrored
// orientation regardless of what the local user's own screen shows.

export type FacingMode = "user" | "environment" | null | undefined;

/**
 * Should this tile's <video> be mirrored via CSS transform?
 *
 * Mirror only when BOTH are true:
 *  - the tile belongs to the local participant (never remote tiles), and
 *  - the active camera is front-facing (facingMode === "user"); the rear
 *    camera ("environment") and any unknown/undetected facing mode are left
 *    un-mirrored so we never guess wrong for a rear-camera publisher.
 */
export function shouldMirrorTile(isLocal: boolean, facingMode: FacingMode): boolean {
  return isLocal && facingMode === "user";
}

/** CSS transform string for a tile, given the mirror decision. */
export function mirrorTransform(mirror: boolean): string {
  return mirror ? "scaleX(-1)" : "none";
}
