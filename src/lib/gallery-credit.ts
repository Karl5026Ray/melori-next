// Credit line stamped on PUBLIC full-resolution downloads (Karl, 2026-10-18:
// "downloads … with this website address on it, melorimusic.org, to let
// people know where it came from"). The owner's own downloads stay clean.
//
// Pure helpers only (no sharp), so the key rule and the overlay geometry can
// be unit-tested without native image libraries.

export const CREDIT_TEXT = "melorimusic.org";

// "melorimusic.org" in Inter SemiBold (the site's typeface), pre-converted to
// outlines at 100px. Drawn as a path, not <text>, because the server that
// stamps photos has no guaranteed fonts, and SVG text without one renders blank.
// Box origin is the top-left of the ink; size is CREDIT_PATH_W × CREDIT_PATH_H.
// Regenerate with opentype.js if the wording ever changes.
const CREDIT_PATH_W = 774.3;
const CREDIT_PATH_H = 97.8;
const CREDIT_PATH =
  "M0 76.2L12.7 76.2L12.7 42.8C12.7 35.5 17.3 31.6 22.9 31.6C28.2 31.6 32.1 35.2 32.1 40.8L32.1 76.2L44.5 76.2L44.5 41.9C44.5 35.8 48.2 31.6 54.4 31.6C59.6 31.6 63.8 34.6 63.8 41.4L63.8 76.2L76.6 76.2L76.6 39.4C76.6 27.3 69.0 20.8 59.2 20.8C51.6 20.8 44.7 24.8 41.8 32.6C39.5 24.9 34.8 20.8 27.8 20.8C21.3 20.8 15.1 24.3 12.3 32.0L11.9 21.6L0 21.6ZM114.2 77.3C126.3 77.3 134.8 71.5 137.5 62.7L125.8 60.3C124.1 64.9 119.9 67.4 114.3 67.4C106.2 67.4 100.6 62.2 100.3 52.5L138.3 52.5L138.3 48.5C138.3 29.3 126.7 20.9 113.3 20.9C97.7 20.9 87.6 32.5 87.6 49.3C87.6 66.4 97.7 77.3 114.2 77.3ZM100.3 43.8C100.9 36.6 105.6 30.9 113.4 30.9C120.9 30.9 125.2 36.0 125.9 43.8ZM161.9 3.5L149.2 3.5L149.2 76.2L161.9 76.2ZM199.0 77.3C214.9 77.3 225.1 66.0 225.1 49.2C225.1 32.2 214.9 20.9 199.0 20.9C183.1 20.9 172.9 32.2 172.9 49.2C172.9 66.0 183.1 77.3 199.0 77.3ZM199.0 67.0C190.2 67.0 185.9 59.1 185.9 49.2C185.9 39.1 190.2 31.3 199.0 31.3C207.9 31.3 212.3 39.1 212.3 49.2C212.3 59.1 207.9 67.0 199.0 67.0ZM236.2 76.2L248.9 76.2L248.9 44.1C248.9 37.2 254.2 32.3 261.2 32.3C263.5 32.3 266.2 32.6 267.2 32.9L267.2 21.2C266.0 21.0 264.0 20.9 262.6 20.9C256.3 20.9 251.1 24.5 249.1 30.8L248.5 30.8L248.5 21.6L236.2 21.6ZM275.9 76.2L288.6 76.2L288.6 21.6L275.9 21.6ZM282.3 13.9C286.3 13.9 289.7 10.8 289.7 6.9C289.7 3.1 286.3 0 282.3 0C278.2 0 274.9 3.1 274.9 6.9C274.9 10.8 278.2 13.9 282.3 13.9ZM302.1 76.2L314.8 76.2L314.8 42.8C314.8 35.5 319.4 31.6 325.0 31.6C330.3 31.6 334.2 35.2 334.2 40.8L334.2 76.2L346.6 76.2L346.6 41.9C346.6 35.8 350.3 31.6 356.5 31.6C361.7 31.6 365.9 34.6 365.9 41.4L365.9 76.2L378.7 76.2L378.7 39.4C378.7 27.3 371.1 20.8 361.3 20.8C353.7 20.8 346.8 24.8 343.9 32.6C341.6 24.9 336.9 20.8 329.9 20.8C323.4 20.8 317.2 24.3 314.4 32.0L314.0 21.6L302.1 21.6ZM410.8 76.9C418.8 76.9 424.5 73.1 427.7 65.3L427.8 76.2L439.9 76.2L439.9 21.6L427.1 21.6L427.1 53.6C427.1 61.5 422.3 66.1 415.5 66.1C408.9 66.1 404.8 61.7 404.8 54.4L404.8 21.6L392.1 21.6L392.1 56.3C392.1 69.5 399.6 76.9 410.8 76.9ZM474.0 77.3C487.8 77.3 497.5 70.2 497.5 59.9C497.5 52.2 492.5 47.3 482.2 45.1L472.9 43.2C467.3 41.9 465.1 39.9 465.1 36.8C465.1 33.1 469.2 30.4 474.6 30.4C480.5 30.4 483.6 33.4 484.9 37.3L496.2 35.0C494.0 26.6 486.8 20.9 474.5 20.9C461.4 20.9 452.4 27.4 452.4 37.5C452.4 45.6 457.5 50.6 467.8 52.8L477.1 54.8C482.1 55.9 484.5 57.9 484.5 61.1C484.5 64.8 480.5 67.6 474.3 67.6C468.1 67.6 464.3 65.0 462.8 59.6L450.9 61.9C452.8 71.8 461.5 77.3 474.0 77.3ZM508.3 76.2L521.0 76.2L521.0 21.6L508.3 21.6ZM514.6 13.9C518.7 13.9 522.1 10.8 522.1 6.9C522.1 3.1 518.7 0 514.6 0C510.6 0 507.3 3.1 507.3 6.9C507.3 10.8 510.6 13.9 514.6 13.9ZM558.2 77.3C570.4 77.3 579.5 70.7 581.8 59.8L570.0 57.3C568.7 63.2 564.5 67.0 558.3 67.0C549.4 67.0 545.0 59.3 545.0 49.2C545.0 39.0 549.4 31.3 558.3 31.3C564.4 31.3 568.5 34.9 569.8 40.6L581.7 38.1C579.3 27.4 570.3 20.9 558.2 20.9C542.2 20.9 532.1 32.2 532.1 49.2C532.1 66.0 542.2 77.3 558.2 77.3ZM601.9 77.1C606.3 77.1 609.8 73.6 609.8 69.2C609.8 64.9 606.3 61.5 601.9 61.5C597.5 61.5 594.1 64.9 594.1 69.2C594.1 73.6 597.5 77.1 601.9 77.1ZM648.3 77.3C664.2 77.3 674.4 66.0 674.4 49.2C674.4 32.2 664.2 20.9 648.3 20.9C632.4 20.9 622.2 32.2 622.2 49.2C622.2 66.0 632.4 77.3 648.3 77.3ZM648.3 67.0C639.5 67.0 635.2 59.1 635.2 49.2C635.2 39.1 639.5 31.3 648.3 31.3C657.2 31.3 661.5 39.1 661.5 49.2C661.5 59.1 657.2 67.0 648.3 67.0ZM685.5 76.2L698.2 76.2L698.2 44.1C698.2 37.2 703.4 32.3 710.5 32.3C712.7 32.3 715.4 32.6 716.5 32.9L716.5 21.2C715.3 21.0 713.3 20.9 711.9 20.9C705.6 20.9 700.3 24.5 698.4 30.8L697.8 30.8L697.8 21.6L685.5 21.6ZM748.7 97.8C763.4 97.8 774.3 91.0 774.3 76.4L774.3 21.6L761.8 21.6L761.8 30.7L761.1 30.7C759.2 26.8 755.0 20.9 745.4 20.9C732.8 20.9 722.8 30.9 722.8 48.8C722.8 66.6 732.7 75.4 745.3 75.4C754.7 75.4 758.7 70.4 760.6 66.5L761.7 66.5L761.7 76.8C761.7 84.6 756.5 88.1 748.7 88.1C740.7 88.1 737.4 84.4 735.6 81.3L724.9 85.2C727.6 92.4 735.6 97.8 748.7 97.8ZM748.8 65.4C740.3 65.4 735.8 58.7 735.8 48.7C735.8 38.8 740.2 31.4 748.8 31.4C757.2 31.4 761.8 38.3 761.8 48.7C761.8 59.1 757.1 65.4 748.8 65.4Z";

// Bump when the stamp's look changes, so cached copies made with the old look
// are replaced on their next download instead of served forever.
const CREDIT_VERSION = 2;

/**
 * Storage key for the credited copy of an original, cached next to it in the
 * private originals bucket so each photo is stamped once, not per download.
 *   a/b/<imageId>/original.jpg → a/b/<imageId>/credit-v2.jpg
 */
export function creditKeyFor(storageKey: string): string {
  const name = `credit-v${CREDIT_VERSION}.jpg`;
  return /\/original\.jpg$/.test(storageKey)
    ? storageKey.replace(/original\.jpg$/, name)
    : `${storageKey}.${name}`;
}

/**
 * SVG overlay for a full-size image: the site address in white on a
 * translucent dark pill, bottom-right. Sized from the image's long edge so it
 * reads the same on a 2000px phone shot and an 8000px camera file — present,
 * not shouting (lettering ~2% of the long edge).
 */
export function creditOverlaySvg(width: number, height: number): string {
  const longEdge = Math.max(width, height);
  const textH = Math.max(14, Math.round(longEdge * 0.022));
  const scale = textH / CREDIT_PATH_H;
  const textW = Math.round(CREDIT_PATH_W * scale);
  const padX = Math.round(textH * 0.7);
  const padY = Math.round(textH * 0.35);
  const boxW = Math.min(width, textW + padX * 2);
  const boxH = Math.min(height, textH + padY * 2);
  const margin = Math.round(textH * 0.9);
  const x = Math.max(0, width - boxW - margin);
  const y = Math.max(0, height - boxH - margin);
  const radius = Math.round(boxH / 2);
  const tx = x + (boxW - textW) / 2;
  const ty = y + (boxH - textH) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${radius}" ry="${radius}" fill="rgba(0,0,0,0.45)"/>
  <path transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(4)})" fill="rgba(255,255,255,0.92)" d="${CREDIT_PATH}"/>
</svg>`;
}
