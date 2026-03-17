/**
 * Handler for apply_style tool.
 * Extracted from the superapp's chatService.ts executeApplyStyle.
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
import { applyStyle } from '@/services/sdk/styleTransfer';
import type { ModelOverride } from '@/services/sdk/imageGeneration';
import { fetchRestorationCostEstimate } from '@/services/creditsService';
import { calculateOutputDimensions } from '@/utils/imageDimensions';

/** Model configs for non-quality-tier models that apply_style can use via retry/switch */
const EXTRA_MODELS: Record<string, ModelOverride> = {
  flux2: { modelId: 'flux2_dev_fp8', name: 'Flux.2 Dev', steps: 20, guidance: 4.0 },
};

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  const sourceIndex = args.sourceImageIndex as number | undefined;
  const scale = (args.scale as number) || 1;
  const aspectRatio = args.aspectRatio as string | undefined;
  const modelKey = args.model as string | undefined;
  const modelOverride = modelKey ? EXTRA_MODELS[modelKey] : undefined;
  const qualityTier = (args.quality as 'fast' | 'hq') || context.qualityTier || 'fast';

  if (!context.imageData && context.resultUrls.length === 0) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload or generate an image first.' });
  }

  // Determine source image: auto-select latest result when no explicit index and no upload
  const effectiveSourceIndex = sourceIndex ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

  let sourceImageData = context.imageData;
  let sourceWidth = context.width;
  let sourceHeight = context.height;

  if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
    try {
      console.log(`[STYLE] Applying style to result image #${effectiveSourceIndex} (${sourceIndex === undefined ? 'auto-selected latest' : 'user-specified'})`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
      sourceImageData = fetched.data;
      sourceWidth = fetched.width;
      sourceHeight = fetched.height;
    } catch (err) {
      if (!context.imageData) {
        return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the previously generated image.' });
      }
      console.error('[STYLE] Failed to fetch source image, using original:', err);
    }
  } else if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available.' });
  }

  if (!sourceImageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available.' });
  }

  const { width: outputWidth, height: outputHeight } = calculateOutputDimensions(
    sourceWidth, sourceHeight, { scale, aspectRatio },
  );

  const originalToken = context.tokenType;
  let estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, 1, qualityTier);

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, 1, qualityTier);
  }

  const sourceImageUrl = (sourceIndex !== undefined && context.resultUrls[sourceIndex]) || undefined;

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'apply_style',
    totalCount: 1,
    estimatedCost,
    sourceImageUrl,
    modelName: `${modelOverride?.name ?? `Qwen Image Edit 2511${qualityTier === 'fast' ? ' Lightning' : ''}`} — ${outputWidth}x${outputHeight}`,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('apply_style', estimatedCost, context.tokenType)
    : null;

  try {
    const resultUrl = await tryWithTokenFallback(
      (tokenType) => applyStyle(
        context.sogniClient,
        {
          imageData: sourceImageData,
          width: outputWidth,
          height: outputHeight,
          tokenType,
          stylePrompt: prompt,
          qualityTier,
          modelOverride,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.type === 'completed' ? 'completed' : 'progress',
            toolName: 'apply_style',
            progress: progress.progress,
            resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
            estimatedCost,
            sourceImageUrl,
          });
        },
        context.signal,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);
    callbacks.onToolComplete('apply_style', [resultUrl]);

    return JSON.stringify({
      success: true,
      resultCount: 1,
      creditsCost: formatCredits(estimatedCost),
      message: `Style applied successfully. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see the styled result.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits.' });
    }
    throw err;
  }
}
