/**
 * Handler for change_angle tool.
 * Extracted from the superapp's chatService.ts executeChangeAngle.
 */

import type { ToolExecutionContext, ToolCallbacks } from '../types';
import {
  fetchImageAsUint8Array,
  preflightCreditCheck,
  tryWithTokenFallback,
  isInsufficientCreditsError,
  registerPendingCost,
  recordCompletion,
  discardPending,
  formatCredits,
} from '../shared';
import { generateAngle } from '@/services/sdk/angleGeneration';
import { fetchAngleCostEstimate } from '@/services/creditsService';
import { QUALITY_PRESETS } from '@/config/qualityPresets';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const description = args.description as string;
  const rawSourceIndex = args.sourceImageIndex as number | undefined;
  const aspectRatio = args.aspectRatio as string | undefined;
  const loraStrength = args.loraStrength as number | undefined;
  // SV3D pipeline is incompatible with Flux.2 — fall back pro to hq
  const qualityTier = context.qualityTier === 'pro' ? 'hq' : (context.qualityTier || 'fast');
  const preset = QUALITY_PRESETS[qualityTier];

  if (!context.imageData && context.resultUrls.length === 0) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload or generate an image first.' });
  }

  // Determine source image:
  // - sourceImageIndex === -1 -> explicitly use original (only if an upload exists)
  // - sourceImageIndex === undefined -> auto-select latest result (or original if none)
  // - sourceImageIndex >= 0 -> use that specific result
  const useOriginal = rawSourceIndex === -1 && context.imageData !== null;
  const effectiveSourceIndex = useOriginal
    ? undefined
    : rawSourceIndex ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

  let sourceImageData = context.imageData;
  let sourceWidth = context.width;
  let sourceHeight = context.height;

  if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
    try {
      console.log(`[ANGLE] Changing angle on result image #${effectiveSourceIndex} (${rawSourceIndex === undefined ? 'auto-selected latest' : 'user-specified'})`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
      sourceImageData = fetched.data;
      sourceWidth = fetched.width;
      sourceHeight = fetched.height;
    } catch (err) {
      if (!context.imageData) {
        return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the previously generated image.' });
      }
      console.error('[ANGLE] Failed to fetch source image for angle change, using original:', err);
    }
  } else if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available.' });
  }

  if (!sourceImageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available.' });
  }

  // Fetch real cost estimate from API
  const originalToken = context.tokenType;
  let estimatedCost = await fetchAngleCostEstimate(
    context.sogniClient, preset.model, preset.steps, preset.guidance, context.tokenType,
  );

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchAngleCostEstimate(
      context.sogniClient, preset.model, preset.steps, preset.guidance, context.tokenType,
    );
  }

  const sourceImageUrl = (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) || undefined;

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'change_angle',
    totalCount: 1,
    estimatedCost,
    sourceImageUrl,
    modelName: `Qwen Image Edit 2511${qualityTier === 'fast' ? ' Lightning' : ''} — ${sourceWidth}x${sourceHeight}`,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('change_angle', estimatedCost, context.tokenType)
    : null;

  let lastAngleProgress: number | undefined;
  let lastAngleEta: number | undefined;

  try {
    const resultUrl = await tryWithTokenFallback(
      (tokenType) => generateAngle(
        context.sogniClient,
        {
          imageData: sourceImageData,
          width: sourceWidth,
          height: sourceHeight,
          tokenType,
          description,
          qualityTier,
          aspectRatio,
          loraStrength,
        },
        (progress) => {
          if (progress.type === 'progress' || progress.type === 'completed') {
            lastAngleProgress = progress.progress;
            callbacks.onToolProgress({
              type: progress.type === 'completed' ? 'completed' : 'progress',
              toolName: 'change_angle',
              progress: progress.progress,
              resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
              etaSeconds: lastAngleEta,
              estimatedCost,
              sourceImageUrl,
            });
          }
          if (progress.type === 'jobETA') {
            lastAngleEta = progress.etaSeconds;
            callbacks.onToolProgress({
              type: 'progress',
              toolName: 'change_angle',
              progress: lastAngleProgress,
              etaSeconds: progress.etaSeconds,
              estimatedCost,
              sourceImageUrl,
            });
          }
        },
        context.signal,
        context.sessionId,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);
    callbacks.onToolComplete('change_angle', [resultUrl]);

    return JSON.stringify({
      success: true,
      resultCount: 1,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated a new camera angle view. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see the result.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits.' });
    }
    throw err;
  }
}
