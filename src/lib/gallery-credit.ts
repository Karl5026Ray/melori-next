// Credit line stamped on PUBLIC full-resolution downloads (Karl, 2026-10-18:
// "downloads … with this website address on it, melorimusic.org, to let
// people know where it came from"). The owner's own downloads stay clean.
//
// Pure helpers only (no sharp), so the key rule and the overlay geometry can
// be unit-tested without native image libraries.

export const CREDIT_TEXT = "melorimusic.org";

/**
 * Storage key for the credited copy of an original, cached next to it in the
 * private originals bucket so each photo is stamped once, not per download.
 *   a/b/<imageId>/original.jpg → a/b/<imageId>/download.jpg
 */
export function creditKeyFor(storageKey: string): string {
  return /\/original\.jpg$/.test(storageKey)
    ? storageKey.replace(/original\.jpg$/, "download.jpg")
    : `${storageKey}.credit.jpg`;
}

/**
 * SVG overlay for a full-size image: the site address in white on a
 * translucent dark pill, bottom-right. Sized from the image's long edge so it
 * reads the same on a 2000px phone shot and an 8000px camera file — present,
 * not shouting (~2% of the long edge).
 */
export function creditOverlaySvg(width: number, height: number): string {
  const longEdge = Math.max(width, height);
  const fontSize = Math.max(14, Math.round(longEdge * 0.02));
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.45);
  // Arial-ish average glyph width; a little generous so text never clips.
  const textWidth = Math.round(CREDIT_TEXT.length * fontSize * 0.56);
  const boxW = Math.min(width, textWidth + padX * 2);
  const boxH = Math.min(height, fontSize + padY * 2);
  const margin = Math.round(fontSize * 0.9);
  const x = Math.max(0, width - boxW - margin);
  const y = Math.max(0, height - boxH - margin);
  const radius = Math.round(boxH / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${radius}" ry="${radius}" fill="rgba(0,0,0,0.45)"/>
  <text x="${x + boxW / 2}" y="${y + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="600" font-size="${fontSize}" fill="rgba(255,255,255,0.92)">${CREDIT_TEXT}</text>
</svg>`;
}
