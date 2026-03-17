/**
 * Handler for refine_result tool.
 * Extracted from the superapp's chatService.ts executeRefineResult.
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
import { restorePhoto } from '@/services/sdk/imageGeneration';
import type { ModelOverride } from '@/services/sdk/imageGeneration';
import { fetchRestorationCostEstimate } from '@/services/creditsService';
import { calculateOutputDimensions } from '@/utils/imageDimensions';

/** Model configs for non-quality-tier models that refine_result can use via retry/switch */
const EXTRA_MODELS: Record<string, ModelOverride> = {
  flux2: { modelId: 'flux2_dev_fp8', name: 'Flux.2 Dev', steps: 20, guidance: 4.0 },
};

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  // Default to latest result (last index) when not specified
  const sourceIndex = (args.sourceImageIndex as number | undefined) ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : 0);
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const modelKey = args.model as string | undefined;
  const modelOverride = modelKey ? EXTRA_MODELS[modelKey] : undefined;
  const scale = (args.scale as number) || 1;
  const aspectRatio = args.aspectRatio as string | undefined;

  if (!context.resultUrls[sourceIndex]) {
    return JSON.stringify({
      error: 'invalid_source',
      message: `Image #${sourceIndex + 1} does not exist. Ask the user which image they want to refine.`,
    });
  }

  // Fetch the result image to refine
  let sourceImageData: Uint8Array;
  let sourceWidth: number;
  let sourceHeight: number;
  try {
    const fetched = await fetchImageAsUint8Array(context.resultUrls[sourceIndex]);
    sourceImageData = fetched.data;
    sourceWidth = fetched.width;
    sourceHeight = fetched.height;
  } catch (_err) {
    return JSON.stringify({ error: 'fetch_failed', message: 'Could not load the source image for refinement.' });
  }

  const { width: outputWidth, height: outputHeight } = calculateOutputDimensions(
    sourceWidth, sourceHeight, { scale, aspectRatio },
  );

  const qualityTier = context.qualityTier || 'fast';
  const originalToken = context.tokenType;
  let estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, numberOfMedia, qualityTier);

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, numberOfMedia, qualityTier);
  }

  const sourceImageUrl = context.resultUrls[sourceIndex];

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'refine_result',
    totalCount: numberOfMedia,
    estimatedCost,
    sourceImageUrl,
    modelName: `${modelOverride?.name ?? `Qwen Image Edit 2511${qualityTier === 'fast' ? ' Lightning' : ''}`} — ${outputWidth}x${outputHeight}`,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('refine_result', estimatedCost, context.tokenType)
    : null;

  try {
    const resultUrls = await tryWithTokenFallback(
      (tokenType) => restorePhoto(
        context.sogniClient,
        {
          imageData: sourceImageData,
          width: outputWidth,
          height: outputHeight,
          tokenType,
          customPrompt: prompt,
          numberOfMedia,
          qualityTier,
          modelOverride,
        },
        (progress) => {
          if (progress.type === 'progress' || progress.type === 'completed') {
            callbacks.onToolProgress({
              type: progress.type === 'completed' ? 'completed' : 'progress',
              toolName: 'refine_result',
              progress: progress.progress,
              completedCount: progress.completedCount,
              totalCount: progress.totalCount,
              jobIndex: progress.jobIndex,
              resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
              estimatedCost,
              sourceImageUrl,
            });
          }
        },
        context.signal,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);
    callbacks.onToolComplete('refine_result', resultUrls);

    return JSON.stringify({
      success: true,
      resultCount: resultUrls.length,
      creditsCost: formatCredits(estimatedCost),
      message: `Generated ${resultUrls.length} refined variation${resultUrls.length !== 1 ? 's' : ''} of image #${sourceIndex + 1}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see the results.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits.' });
    }
    throw err;
  }
}
