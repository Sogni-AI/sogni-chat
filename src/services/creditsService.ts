/**
 * Credits Service
 * Provides cost estimation and credit tracking for restoration operations.
 * All cost estimates come from API endpoints — no hardcoded values.
 */
import type { SogniClient } from '@sogni-ai/sogni-client';
import { QUALITY_PRESETS, type QualityTier } from '@/config/qualityPresets';

/**
 * Fetch restoration cost estimate via the SDK's estimateCost method.
 * Previously called POST /api/restore/estimate-cost (removed with restoration.js).
 */
export async function fetchRestorationCostEstimate(
  sogniClient: SogniClient,
  tokenType: string,
  numberOfImages: number,
  qualityTier: QualityTier = 'fast',
): Promise<number> {
  try {
    const preset = QUALITY_PRESETS[qualityTier];
    const projectsApi = sogniClient.projects as any;
    if (!projectsApi || typeof projectsApi.estimateCost !== 'function') {
      throw new Error('estimateCost not available on SDK');
    }
    const result = await projectsApi.estimateCost({
      model: preset.model,
      imageCount: numberOfImages,
      previewCount: 0,
      stepCount: preset.steps,
      guidance: preset.guidance,
      contextImages: 1,
      tokenType,
    });
    const cost = typeof result?.token === 'string' ? parseFloat(result.token) : result?.token;
    if (cost === undefined || isNaN(cost)) throw new Error('Invalid cost value');
    console.log(`[CREDITS] Restoration cost estimate: ${cost} ${tokenType} (${numberOfImages} images, ${qualityTier})`);
    return cost;
  } catch (err) {
    console.warn('[CREDITS] Restoration cost estimation failed:', err);
    throw err;
  }
}

/**
 * Fetch video generation cost estimate from the Sogni API.
 */
export async function fetchVideoCostEstimate(
  tokenType: string,
  modelId: string,
  width: number,
  height: number,
  frames: number,
  fps: number,
  steps: number,
): Promise<number> {
  try {
    const url = `https://socket.sogni.ai/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}/1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const project = data?.quote?.project;
    if (!project) throw new Error('No quote in response');
    const costRaw = tokenType === 'spark' ? project.costInSpark : project.costInSogni;
    const cost = typeof costRaw === 'string' ? parseFloat(costRaw) : costRaw;
    if (cost === undefined || isNaN(cost)) throw new Error('Invalid cost value');
    console.log(`[CREDITS] Video cost estimate: ${cost} ${tokenType}`);
    return cost;
  } catch (err) {
    console.warn('[CREDITS] Video cost estimation failed:', err);
    throw err;
  }
}

/**
 * Fetch angle generation cost estimate via the SDK's estimateCost method.
 */
export async function fetchAngleCostEstimate(
  sogniClient: SogniClient,
  model: string,
  steps: number,
  guidance: number,
  tokenType: string,
): Promise<number> {
  try {
    const projectsApi = sogniClient.projects as any;
    if (!projectsApi || typeof projectsApi.estimateCost !== 'function') {
      throw new Error('estimateCost not available on SDK');
    }
    const result = await projectsApi.estimateCost({
      model,
      imageCount: 1,
      previewCount: 0,
      stepCount: steps,
      scheduler: 'simple',
      guidance,
      contextImages: 1,
      tokenType,
    });
    const cost = typeof result?.token === 'string' ? parseFloat(result.token) : result?.token;
    if (cost === undefined || isNaN(cost)) throw new Error('Invalid cost value');
    console.log(`[CREDITS] Angle cost estimate: ${cost} ${tokenType}`);
    return cost;
  } catch (err) {
    console.warn('[CREDITS] Angle cost estimation failed:', err);
    throw err;
  }
}

/**
 * Fetch image generation/edit cost estimate via the SDK's estimateCost method.
 */
export async function fetchImageCostEstimate(
  sogniClient: SogniClient,
  tokenType: string,
  model: string,
  imageCount: number,
  steps: number,
  guidance: number | undefined,
  sampler: string,
  contextImages: number = 0,
): Promise<number> {
  try {
    const projectsApi = sogniClient.projects as any;
    if (!projectsApi || typeof projectsApi.estimateCost !== 'function') {
      throw new Error('estimateCost not available on SDK');
    }
    const result = await projectsApi.estimateCost({
      model,
      imageCount,
      previewCount: 0,
      stepCount: steps,
      guidance: guidance ?? 0,
      sampler,
      contextImages,
      tokenType,
    });
    const cost = typeof result?.token === 'string' ? parseFloat(result.token) : result?.token;
    if (cost === undefined || isNaN(cost)) throw new Error('Invalid cost value');
    console.log(`[CREDITS] Image cost estimate: ${cost} ${tokenType} (${imageCount} images, ${model})`);
    return cost;
  } catch (err) {
    console.warn('[CREDITS] Image cost estimation failed:', err);
    throw err;
  }
}

/**
 * Fetch audio generation cost estimate via the SDK's estimateAudioCost method.
 */
export async function fetchAudioCostEstimate(
  sogniClient: SogniClient,
  tokenType: string,
  model: string,
  duration: number,
  steps: number,
  numberOfMedia: number = 1,
): Promise<number> {
  try {
    const projectsApi = sogniClient.projects as any;
    if (!projectsApi || typeof projectsApi.estimateAudioCost !== 'function') {
      throw new Error('estimateAudioCost not available on SDK');
    }
    const result = await projectsApi.estimateAudioCost({
      tokenType,
      model,
      duration,
      steps,
      numberOfMedia,
    });
    const cost = typeof result?.token === 'string' ? parseFloat(result.token) : result?.token;
    if (cost === undefined || isNaN(cost)) throw new Error('Invalid cost value');
    console.log(`[CREDITS] Audio cost estimate: ${cost} ${tokenType} (${duration}s, ${model})`);
    return cost;
  } catch (err) {
    console.warn('[CREDITS] Audio cost estimation failed:', err);
    throw err;
  }
}

/**
 * Format credits for display
 * @param credits - Number of credits
 * @param showDecimals - Whether to show decimal places (default: false for balances, true for costs)
 * @returns Formatted string
 */
export function formatCredits(credits: number, showDecimals: boolean = false): string {
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(1)}k`;
  }
  // Show decimals if requested or if value is less than 10
  if (showDecimals || credits < 10) {
    return credits.toFixed(1);
  }
  return credits.toFixed(0);
}

/**
 * Get credit status color (for UI)
 * @param balance - Current credit balance
 * @param estimatedCost - Estimated cost for operation
 * @returns Color string
 */
export function getCreditStatusColor(balance: number, estimatedCost: number = 0): 'green' | 'yellow' | 'red' {
  const remaining = balance - estimatedCost;

  if (remaining < 0) {
    return 'red'; // Out of credits
  } else if (remaining < estimatedCost * 2) {
    return 'yellow'; // Low credits
  } else {
    return 'green'; // Plenty of credits
  }
}
