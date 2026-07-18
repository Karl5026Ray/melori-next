const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const chalk = require('chalk');

// Only formats sharp can reliably decode. RAW (.cr2/.nef/.raw) is intentionally
// dropped — sharp cannot decode most RAW files. Any file that still fails to
// decode is skipped with a clear warning rather than aborting the whole batch.
const ACCEPTED = /\.(jpe?g|png|webp|tiff?)$/i;

function isAccepted(file) {
  return ACCEPTED.test(file);
}

// Build a tiled, semi-transparent watermark overlay sized to the image so the
// public preview is clearly marked while the ORIGINAL stays clean.
function watermarkSvg(width, height, text) {
  const tile = 320;
  const safeText = String(text || 'Melori Music').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="wm" x="0" y="0" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <text x="0" y="${tile / 2}" font-family="Arial, sans-serif" font-size="22" fill="rgba(255,255,255,0.28)">${safeText}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)"/>
    </svg>
  `);
}

// For each accepted file produce three artifacts:
//   original  — clean, auto-rotated, full-resolution JPEG (no watermark)
//   preview   — watermarked JPEG resized to maxWidth
//   thumbnail — watermarked 400x400 cover crop
async function processImages(files, options = {}) {
  const {
    maxWidth = 2400,
    quality = 90,
    clientName = '',
    galleryName = '',
  } = options;

  const watermarkText = clientName
    ? `${clientName} | Melori Music`
    : galleryName
      ? `${galleryName} | Melori Music`
      : 'Melori Music';

  const processed = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melori-'));

  for (const filePath of files) {
    if (!isAccepted(filePath)) {
      console.warn(chalk.yellow(`Skipping unsupported file: ${path.basename(filePath)}`));
      continue;
    }

    const base = path.basename(filePath, path.extname(filePath));
    const originalPath = path.join(tempDir, `${base}.jpg`);
    const previewPath = path.join(tempDir, `${base}_preview.jpg`);
    const thumbPath = path.join(tempDir, `${base}_thumb.jpg`);

    try {
      // Clean original — full resolution, auto-rotated, high quality.
      await sharp(filePath)
        .rotate()
        .jpeg({ quality: Math.max(quality, 92), progressive: true, mozjpeg: true })
        .toFile(originalPath);

      const meta = await sharp(originalPath).metadata();
      const pw = Math.min(meta.width || maxWidth, maxWidth);
      const ph = Math.round(((meta.height || pw) * pw) / (meta.width || pw));

      // Watermarked preview.
      await sharp(originalPath)
        .resize(maxWidth, null, { withoutEnlargement: true, fit: 'inside' })
        .composite([{ input: watermarkSvg(pw, ph, watermarkText), blend: 'over' }])
        .jpeg({ quality, progressive: true, mozjpeg: true })
        .toFile(previewPath);

      // Watermarked thumbnail.
      await sharp(originalPath)
        .resize(400, 400, { fit: 'cover' })
        .composite([{ input: watermarkSvg(400, 400, watermarkText), blend: 'over' }])
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      const blurHash = await generateBlurHash(originalPath);

      processed.push({
        source: filePath,
        original: originalPath,
        preview: previewPath,
        thumbnail: thumbPath,
        filename: `${base}.jpg`,
        blurHash,
      });
    } catch (err) {
      console.warn(
        chalk.yellow(`Skipping ${path.basename(filePath)} (could not decode): ${err.message}`),
      );
    }
  }

  return processed;
}

// Tiny base64 JPEG stand-in for a blur-hash placeholder (kept dependency-free).
async function generateBlurHash(imagePath) {
  const tiny = await sharp(imagePath)
    .resize(20, 20, { fit: 'cover' })
    .jpeg({ quality: 30 })
    .toBuffer();
  return `data:image/jpeg;base64,${tiny.toString('base64')}`;
}

module.exports = { processImages, generateBlurHash, isAccepted, ACCEPTED };
