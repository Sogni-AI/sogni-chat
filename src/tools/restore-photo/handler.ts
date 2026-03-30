/**
 * Handler for restore_photo tool.
 * Extracted from the superapp's chatService.ts executeRestorePhoto.
 */

import type { ToolExecutionContext, ToolCallbacks } from '../types';
import {
  preflightCreditCheck,
  tryWithTokenFallback,
  isInsufficientCreditsError,
  registerPendingCost,
  recordCompletion,
  discardPending,
  formatCredits,
  uint8ArrayToDataUri,
} from '../shared';
import { restorePhoto } from '@/services/sdk/imageGeneration';
import type { ModelOverride } from '@/services/sdk/imageGeneration';
import { fetchRestorationCostEstimate } from '@/services/creditsService';
import { calculateOutputDimensions } from '@/utils/imageDimensions';

/** Model configs for non-quality-tier models that restore_photo can use via retry/switch */
const EXTRA_MODELS: Record<string, ModelOverride> = {
  flux2: { modelId: 'flux2_dev_fp8', name: 'Flux.2 Dev', steps: 40, guidance: 4.0 },
};

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const modelKey = args.model as string | undefined;
  const isPro = !modelKey && context.qualityTier === 'pro';
  const modelOverride = modelKey ? EXTRA_MODELS[modelKey] : (isPro ? EXTRA_MODELS['flux2'] : undefined);
  // For cost estimation, use 'pro' so the Flux.2 preset is used; for output format, fall back to 'hq'
  const costTier = isPro ? 'pro' : ((args.quality as 'fast' | 'hq') || context.qualityTier || 'fast');
  const qualityTier = isPro ? 'hq'
    : modelOverride ? (context.qualityTier || 'fast')
    : (args.quality as 'fast' | 'hq') || context.qualityTier || 'fast';
  const scale = (args.scale as number) || 1;
  const aspectRatio = args.aspectRatio as string | undefined;

  if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload an image first.' });
  }

  const { width: outputWidth, height: outputHeight } = calculateOutputDimensions(
    context.width, context.height, { scale, aspectRatio },
  );

  const originalToken = context.tokenType;
  let estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, numberOfMedia, costTier);

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, numberOfMedia, qualityTier);
  }

  const sourceImageUrl = context.imageData
    ? uint8ArrayToDataUri(context.imageData, 'image/jpeg')
    : undefined;

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'restore_photo',
    totalCount: numberOfMedia,
    estimatedCost,
    modelName: `${modelOverride?.name ?? `Qwen Image Edit 2511${qualityTier === 'fast' ? ' Lightning' : ''}`} — ${outputWidth}x${outputHeight}`,
    sourceImageUrl,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('restore_photo', estimatedCost, context.tokenType)
    : null;

  try {
    const resultUrls = await tryWithTokenFallback(
      (tokenType) => restorePhoto(
        context.sogniClient,
        {
          imageData: context.imageData!,
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
              toolName: 'restore_photo',
              progress: progress.progress,
              completedCount: progress.completedCount,
              totalCount: progress.totalCount,
              jobIndex: progress.jobIndex,
              etaSeconds: progress.etaSeconds,
              resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
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
    callbacks.onToolComplete('restore_photo', resultUrls);

    return JSON.stringify({
      success: true,
      resultCount: resultUrls.length,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${resultUrls.length} restored variation${resultUrls.length !== 1 ? 's' : ''}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see the results.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for this operation.' });
    }
    throw err;
  }
}
