/**
 * imageOptimizer.ts
 *
 * Token-efficient screenshot utilities for browser-agent tracing.
 *
 * Why this matters:
 *   - Raw 1920×1080 PNG → ~800 KB base64 → ~2,000–3,000 vision tokens
 *   - 1024×576 JPEG q=60 → ~55 KB base64 → ~300–500 vision tokens
 *   - ~85–92% token reduction with no meaningful accuracy loss.
 *
 * Exports
 *  compressScreenshot()          — resize + PNG→JPEG
 *  cropToRegion()                — crop to element bounding box then compress
 *  pixelDiffRatio()              — perceptual change score 0–1
 *  hasPageChangedSignificantly() — boolean gate for skipping unchanged frames
 */

import sharp from 'sharp';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompressOptions {
  /** Max width in pixels — image is scaled down proportionally. Default: 1024 */
  maxWidth?: number;
  /** JPEG quality 1–100. Default: 60 */
  quality?: number;
  /** Convert to grayscale (saves ~30% more tokens, loses color cues). Default: false */
  grayscale?: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Core compression ───────────────────────────────────────────────────────

/**
 * Compress a raw PNG buffer to a token-efficient JPEG.
 *
 * Usage:
 *   const jpeg = await compressScreenshot(pngBuffer);
 *   const b64  = jpeg.toString('base64');
 *   // embed as: data:image/jpeg;base64,<b64>
 */
export async function compressScreenshot(
  pngBuffer: Buffer,
  opts: CompressOptions = {},
): Promise<Buffer> {
  const { maxWidth = 1024, quality = 60, grayscale = false } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pipeline = (sharp as any)(pngBuffer).resize(maxWidth, undefined, {
    fit: 'inside',
    withoutEnlargement: true, // never upscale a small screenshot
  });

  if (grayscale) {
    pipeline = pipeline.grayscale();
  }

  return pipeline.jpeg({ quality }).toBuffer() as Promise<Buffer>;
}

// ── Region-of-interest cropping ────────────────────────────────────────────

/**
 * Crop a screenshot to a specific element's bounding box, then compress.
 * Use when Claude only needs to verify a localised area (e.g. a form field).
 *
 * @param pngBuffer  Raw PNG from Playwright
 * @param bbox       Element bounding box {x, y, width, height}
 * @param padding    Extra pixels around the element. Default: 50
 */
export async function cropToRegion(
  pngBuffer: Buffer,
  bbox: BoundingBox,
  padding = 50,
  opts: CompressOptions = {},
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = await (sharp as any)(pngBuffer).metadata() as { width?: number; height?: number };
  const imgW = meta.width  ?? 1920;
  const imgH = meta.height ?? 1080;

  const left   = Math.max(0, Math.floor(bbox.x - padding));
  const top    = Math.max(0, Math.floor(bbox.y - padding));
  const width  = Math.min(imgW - left, Math.ceil(bbox.width  + padding * 2));
  const height = Math.min(imgH - top,  Math.ceil(bbox.height + padding * 2));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropped: Buffer = await (sharp as any)(pngBuffer)
    .extract({ left, top, width, height })
    .toBuffer();

  return compressScreenshot(cropped, opts);
}

// ── Perceptual diff ────────────────────────────────────────────────────────

/**
 * Compute a normalised pixel-change ratio between two screenshots.
 *
 * Downsamples both images to a 32×18 greyscale thumbnail before comparing,
 * making this very fast (<1 ms per call after sharp initialises).
 *
 * @returns 0 = identical, 1 = completely different
 */
export async function pixelDiffRatio(
  prevBuffer: Buffer,
  currBuffer: Buffer,
): Promise<number> {
  const THUMB_W = 32;
  const THUMB_H = 18;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toThumb = (buf: Buffer) =>
    (sharp as any)(buf)
      .resize(THUMB_W, THUMB_H, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer() as Promise<Buffer>;

  const [prevRaw, currRaw] = await Promise.all([toThumb(prevBuffer), toThumb(currBuffer)]);

  let totalDiff = 0;
  const pixelCount = THUMB_W * THUMB_H;

  for (let i = 0; i < pixelCount; i++) {
    totalDiff += Math.abs((prevRaw[i] ?? 0) - (currRaw[i] ?? 0));
  }

  return totalDiff / (pixelCount * 255);
}

/**
 * Returns true if the page has changed enough to warrant a fresh screenshot
 * being sent to the LLM.
 *
 * @param threshold  Default 0.04 (4% of pixels changed). Tune downward for
 *                   stricter change detection, upward to skip more.
 */
export async function hasPageChangedSignificantly(
  prevBuffer: Buffer,
  currBuffer: Buffer,
  threshold = 0.04,
): Promise<boolean> {
  try {
    const ratio = await pixelDiffRatio(prevBuffer, currBuffer);
    return ratio > threshold;
  } catch {
    // If diff check fails for any reason, always treat as changed (safe default)
    return true;
  }
}

// ── MIME helper ────────────────────────────────────────────────────────────

/**
 * Build the data-URI prefix for a compressed JPEG.
 * Use like: `${jpegDataPrefix()}${buf.toString('base64')}`
 */
export function jpegDataPrefix(): string {
  return 'data:image/jpeg;base64,';
}
