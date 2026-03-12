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
} from '../shared';
import { restorePhoto } from '@/services/sdk/imageGeneration';
import { fetchRestorationCostEstimate } from '@/services/creditsService';
import { calculateOutputDimensions } from '@/utils/imageDimensions';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const qualityTier = (args.quality as 'fast' | 'hq') || context.qualityTier || 'fast';
  const scale = (args.scale as number) || 1;
  const aspectRatio = args.aspectRatio as string | undefined;

  if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload an image first.' });
  }

  const { width: outputWidth, height: outputHeight } = calculateOutputDimensions(
    context.width, context.height, { scale, aspectRatio },
  );

  const originalToken = context.tokenType;
  let estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, numberOfMedia, qualityTier);

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, numberOfMedia, qualityTier);
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'restore_photo',
    totalCount: numberOfMedia,
    estimatedCost,
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
            });
          }
        },
        context.signal,
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
