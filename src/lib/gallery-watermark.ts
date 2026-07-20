import sharp from "sharp";

// Server-only helper: turns a raw uploaded image buffer into a watermarked
// preview + thumbnail pair for the studio gallery upload route. Mirrors the
// watermark approach used by the melori-gallery CLI (src/lib/image.js) so
// previews look consistent whether uploaded via CLI or the browser/phone.
//
// Preview: max 1600px long edge (spec). Thumbnail: max 500px long edge.
// Watermark: "© Karl Ray Photography" tiled diagonally at ~40% opacity,
// rendered as an SVG overlay composited over the resized JPEG.

const PREVIEW_MAX_EDGE = 1600;
const THUMBNAIL_MAX_EDGE = 500;
const WATERMARK_TEXT = "© Karl Ray Photography";

function escapeXml(input: string): string {
  return input.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

function watermarkSvg(width: number, height: number): Buffer {
  const tile = 260;
  const safeText = escapeXml(WATERMARK_TEXT);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="wm" x="0" y="0" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <text x="0" y="${tile / 2}" font-family="Arial, sans-serif" font-size="18" fill="rgba(255,255,255,0.4)">${safeText}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)"/>
    </svg>
  `);
}

export interface WatermarkedImages {
  previewBuffer: Buffer;
  thumbnailBuffer: Buffer;
}

// Produces watermarked preview + thumbnail JPEG buffers from a raw source
// buffer (any format sharp can decode). Auto-rotates via EXIF orientation.
export async function generateWatermarkedImages(
  sourceBuffer: Buffer,
): Promise<WatermarkedImages> {
  const rotated = sharp(sourceBuffer).rotate();
  const meta = await rotated.metadata();
  const srcWidth = meta.width ?? PREVIEW_MAX_EDGE;
  const srcHeight = meta.height ?? PREVIEW_MAX_EDGE;

  const previewScale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(srcWidth, srcHeight));
  const previewWidth = Math.max(1, Math.round(srcWidth * previewScale));
  const previewHeight = Math.max(1, Math.round(srcHeight * previewScale));

  const previewBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .composite([{ input: watermarkSvg(previewWidth, previewHeight), blend: "over" }])
    .jpeg({ quality: 88, progressive: true, mozjpeg: true })
    .toBuffer();

  const thumbScale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(srcWidth, srcHeight));
  const thumbWidth = Math.max(1, Math.round(srcWidth * thumbScale));
  const thumbHeight = Math.max(1, Math.round(srcHeight * thumbScale));

  const thumbnailBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .composite([{ input: watermarkSvg(thumbWidth, thumbHeight), blend: "over" }])
    .jpeg({ quality: 78 })
    .toBuffer();

  return { previewBuffer, thumbnailBuffer };
}

// Clean, auto-rotated, full-quality JPEG re-encode for the private original.
// Re-encoding (rather than storing the raw upload byte-for-byte) normalizes
// EXIF orientation and guards against non-JPEG phone formats (e.g. HEIC that
// the browser already converted, or PNG screenshots) landing in the bucket
// with a mismatched contentType.
export async function normalizeOriginalJpeg(sourceBuffer: Buffer): Promise<Buffer> {
  return sharp(sourceBuffer)
    .rotate()
    .jpeg({ quality: 95, progressive: true, mozjpeg: true })
    .toBuffer();
}
