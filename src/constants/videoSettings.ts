/**
 * Video Generation Settings -- Dual Model Support (WAN 2.2 + LTX-2)
 */

import { parseAspectRatio } from '@/utils/imageDimensions';

// ============================================================================
// Model IDs & Types
// ============================================================================

export type VideoModelId = 'wan22' | 'ltx2' | 'wan22-hq' | 'ltx2-hq' | 'ltx23';

export interface VideoModelConfig {
  model: string;
  fps: number;
  steps: number;
  guidance: number;
  dimensionDivisor: number;
  minDimension: number;
  maxDimension: number;
  sampler: string;
  scheduler: string;
  /** WAN-specific: shift parameter */
  shift?: number;
  /** LTX-2-specific: I2V conditioning strength */
  strength?: number;
  /** Fixed shorter-side resolution tiers (e.g. LTX-2 snaps to 1088 or 768) */
  resolutionTiers?: number[];
  /** Source image shorter-side threshold: below this -> use lower tier */
  resolutionThreshold?: number;
}

export const VIDEO_MODEL_CONFIGS: Record<VideoModelId, VideoModelConfig> = {
  wan22: {
    model: 'wan_v2.2-14b-fp8_i2v_lightx2v',
    fps: 16,
    steps: 4,
    guidance: 5.0,
    dimensionDivisor: 16,
    minDimension: 480,
    maxDimension: 1536,
    sampler: 'euler',
    scheduler: 'simple',
    shift: 8.0,
  },
  'wan22-hq': {
    model: 'wan_v2.2-14b-fp8_i2v',
    fps: 16,
    steps: 20,
    guidance: 5.0,
    dimensionDivisor: 16,
    minDimension: 480,
    maxDimension: 1536,
    sampler: 'euler',
    scheduler: 'simple',
    shift: 8.0,
  },
  ltx2: {
    model: 'ltx23-22b-fp8_i2v_distilled',
    fps: 24,
    steps: 8,
    guidance: 1.0,
    dimensionDivisor: 64,
    minDimension: 640,
    maxDimension: 3840,
    sampler: 'euler',
    scheduler: 'simple',
    strength: 0.90,
    // LTX-2 snaps shorter side to 1088 (HD) or 768 (720p)
    resolutionTiers: [1088, 768],
    resolutionThreshold: 720, // source shorter side < 720 -> use 768 tier
  },
  'ltx2-hq': {
    model: 'ltx2-19b-fp8_i2v',
    fps: 24,
    steps: 20,
    guidance: 1.0,
    dimensionDivisor: 64,
    minDimension: 640,
    maxDimension: 3840,
    sampler: 'euler',
    scheduler: 'simple',
    strength: 0.90,
    resolutionTiers: [1088, 768],
    resolutionThreshold: 720,
  },
  ltx23: {
    model: 'ltx23-22b-fp8_i2v_distilled',
    fps: 24,
    steps: 8,
    guidance: 1.0,
    dimensionDivisor: 64,
    minDimension: 640,
    maxDimension: 3840,
    sampler: 'euler',
    scheduler: 'simple',
    strength: 0.90,
    resolutionTiers: [1088, 768],
    resolutionThreshold: 720,
  },
};

/** Switch this to change the default video model everywhere */
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'ltx2';

// ============================================================================
// Derived Convenience Exports (use default model)
// ============================================================================

export function getVideoModelConfig(modelId: VideoModelId = DEFAULT_VIDEO_MODEL): VideoModelConfig {
  return VIDEO_MODEL_CONFIGS[modelId];
}

/** Backward-compatible VIDEO_CONFIG using the default model */
export const VIDEO_CONFIG = {
  get defaultFps() { return getVideoModelConfig().fps; },
  get defaultDuration() { return 5; },
  get dimensionDivisor() { return getVideoModelConfig().dimensionDivisor; },
  get minDimension() { return getVideoModelConfig().minDimension; },
  get maxDimension() { return getVideoModelConfig().maxDimension; },
  get defaultFrames() { return calculateVideoFrames(5); },
};

export const VIDEO_QUALITY_PRESETS = {
  fast: {
    get model() { return getVideoModelConfig().model; },
    get steps() { return getVideoModelConfig().steps; },
    label: 'Fast',
    description: 'Quick generation (~15-30s)',
  },
} as const;

export type VideoQualityPreset = keyof typeof VIDEO_QUALITY_PRESETS;

// ============================================================================
// Dimension & Frame Calculations
// ============================================================================

export function calculateVideoDimensions(
  imageWidth: number,
  imageHeight: number,
  targetResolution?: number,
  modelId: VideoModelId = DEFAULT_VIDEO_MODEL,
  aspectRatio?: string,
): { width: number; height: number } {
  const config = VIDEO_MODEL_CONFIGS[modelId];
  const divisor = config.dimensionDivisor;
  const minDim = config.minDimension;
  const maxDim = config.maxDimension;

  // Aspect ratio override -- compute effective source dimensions from the target ratio
  const parsed = parseAspectRatio(aspectRatio);
  let effectiveW = imageWidth;
  let effectiveH = imageHeight;

  if (parsed?.type === 'exact') {
    effectiveW = parsed.width;
    effectiveH = parsed.height;
  } else if (parsed?.type === 'ratio') {
    // Preserve approximate pixel area while adopting the new ratio
    const srcArea = imageWidth * imageHeight;
    const ratio = parsed.ratioW / parsed.ratioH;
    effectiveW = Math.sqrt(srcArea * ratio);
    effectiveH = srcArea / effectiveW;
  }

  // Resolution tier logic: snap shorter side to a fixed tier (e.g. LTX-2: 1088 or 768)
  if (config.resolutionTiers && config.resolutionTiers.length > 0 && targetResolution === undefined) {
    const srcShorter = Math.min(effectiveW, effectiveH);
    const threshold = config.resolutionThreshold ?? config.resolutionTiers[config.resolutionTiers.length - 1];
    // Pick tier: use highest tier unless source is below threshold
    const tier = srcShorter < threshold
      ? config.resolutionTiers[config.resolutionTiers.length - 1] // lower tier (768)
      : config.resolutionTiers[0]; // higher tier (1088)

    let w: number, h: number;
    if (effectiveW <= effectiveH) {
      w = tier;
      h = Math.round((effectiveH * tier / effectiveW) / divisor) * divisor;
    } else {
      h = tier;
      w = Math.round((effectiveW * tier / effectiveH) / divisor) * divisor;
    }

    // Clamp longer side to maxDimension
    w = Math.min(maxDim, w);
    h = Math.min(maxDim, h);

    return { width: w, height: h };
  }

  // General logic for models without resolution tiers (WAN 2.2)
  let w = effectiveW;
  let h = effectiveH;

  // If a target resolution is specified, set the shorter side to it
  if (targetResolution !== undefined) {
    const roundedTarget = Math.round(targetResolution / divisor) * divisor;
    if (w <= h) {
      h = Math.round((h * roundedTarget / w) / divisor) * divisor;
      w = roundedTarget;
    } else {
      w = Math.round((w * roundedTarget / h) / divisor) * divisor;
      h = roundedTarget;
    }
  }

  // Scale down proportionally if the larger dimension exceeds max
  const larger = Math.max(w, h);
  if (larger > maxDim) {
    const scale = maxDim / larger;
    w *= scale;
    h *= scale;
  }

  // Scale up proportionally if the smaller dimension is below min
  const smaller = Math.min(w, h);
  if (smaller < minDim) {
    const scale = minDim / smaller;
    w *= scale;
    h *= scale;
  }

  // Round to nearest divisor
  w = Math.round(w / divisor) * divisor;
  h = Math.round(h / divisor) * divisor;

  // Final clamp
  w = Math.max(minDim, Math.min(maxDim, w));
  h = Math.max(minDim, Math.min(maxDim, h));

  return { width: w, height: h };
}

export function calculateVideoFrames(
  duration: number = 5,
  modelId: VideoModelId = DEFAULT_VIDEO_MODEL,
): number {
  const config = VIDEO_MODEL_CONFIGS[modelId];
  // LTX-2 frames must satisfy (frames - 1) % 8 === 0
  // WAN 2.2 uses same formula for compatibility
  const rawFrames = config.fps * duration + 1;
  return Math.round((rawFrames - 1) / 8) * 8 + 1;
}
