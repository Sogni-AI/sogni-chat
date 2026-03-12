/**
 * Output dimension calculator for image generation tools.
 * Enforces minimum/maximum constraints and aspect-ratio-preserving scaling.
 */

/** Qwen Image Edit has no hard min/max, but these are practical limits */
export const IMAGE_MIN_DIMENSION = 480;   // Quality floor for image generation
export const IMAGE_MAX_DIMENSION = 2048;  // Practical quality/speed cap
export const IMAGE_DIMENSION_STEP = 8;    // Qwen grid alignment

/** Result of parsing an aspectRatio string */
export type ParsedAspectRatio =
  | { type: 'ratio'; ratioW: number; ratioH: number }
  | { type: 'exact'; width: number; height: number };

/**
 * Parse an aspectRatio string into a structured value.
 * Accepts "W:H" ratios (e.g. "16:9") or "WxH" exact pixels (e.g. "1920x1080").
 * Returns undefined for invalid input.
 */
export function parseAspectRatio(value: string | undefined | null): ParsedAspectRatio | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  // Exact pixels: "1920x1080" or "1920X1080"
  const exactMatch = trimmed.match(/^(\d+)\s*[xX\u00d7]\s*(\d+)$/);
  if (exactMatch) {
    const w = parseInt(exactMatch[1], 10);
    const h = parseInt(exactMatch[2], 10);
    if (w > 0 && h > 0) return { type: 'exact', width: w, height: h };
  }

  // Ratio: "16:9"
  const ratioMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratioMatch) {
    const ratioW = parseFloat(ratioMatch[1]);
    const ratioH = parseFloat(ratioMatch[2]);
    if (ratioW > 0 && ratioH > 0) return { type: 'ratio', ratioW, ratioH };
  }

  return undefined;
}

/**
 * Calculate output dimensions for image generation.
 *
 * When aspectRatio is provided, the output matches that ratio while preserving
 * approximate pixel area from the source. When exact pixels are given, those
 * are used directly. Both paths then apply scale, min/max clamping, and step rounding.
 *
 * Without aspectRatio, preserves the source aspect ratio (original behaviour).
 */
export function calculateOutputDimensions(
  srcWidth: number,
  srcHeight: number,
  options?: {
    scale?: number;
    minDim?: number;
    maxDim?: number;
    step?: number;
    aspectRatio?: string;
  },
): { width: number; height: number } {
  const {
    scale = 1,
    minDim = IMAGE_MIN_DIMENSION,
    maxDim = IMAGE_MAX_DIMENSION,
    step = IMAGE_DIMENSION_STEP,
    aspectRatio,
  } = options ?? {};

  let w: number;
  let h: number;

  const parsed = parseAspectRatio(aspectRatio);

  if (parsed?.type === 'exact') {
    // Exact pixel dimensions — use directly, then apply scale
    w = parsed.width * scale;
    h = parsed.height * scale;
  } else if (parsed?.type === 'ratio') {
    // Ratio — preserve approximate pixel area from the source
    const srcArea = srcWidth * srcHeight * scale * scale;
    const ratio = parsed.ratioW / parsed.ratioH;
    // w * h = srcArea, w / h = ratio -> w = sqrt(srcArea * ratio)
    w = Math.sqrt(srcArea * ratio);
    h = srcArea / w;
  } else {
    // No aspect ratio override — preserve source ratio (original behaviour)
    w = srcWidth * scale;
    h = srcHeight * scale;
  }

  // Enforce minimum on the smaller dimension
  const smaller = Math.min(w, h);
  if (smaller < minDim) {
    const upscale = minDim / smaller;
    w *= upscale;
    h *= upscale;
  }

  // Enforce maximum on the larger dimension
  const larger = Math.max(w, h);
  if (larger > maxDim) {
    const downscale = maxDim / larger;
    w *= downscale;
    h *= downscale;
  }

  // Round to nearest step and clamp
  w = Math.max(step, Math.round(w / step) * step);
  h = Math.max(step, Math.round(h / step) * step);

  return { width: w, height: h };
}
