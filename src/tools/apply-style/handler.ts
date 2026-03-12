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
import { fetchRestorationCostEstimate } from '@/services/creditsService';
import { calculateOutputDimensions } from '@/utils/imageDimensions';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  const sourceIndex = args.sourceImageIndex as number | undefined;
  const scale = (args.scale as number) || 1;
  const aspectRatio = args.aspectRatio as string | undefined;

  if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload an image first.' });
  }

  // Determine source image data
  let sourceImageData: Uint8Array = context.imageData;
  let sourceWidth = context.width;
  let sourceHeight = context.height;

  if (sourceIndex !== undefined && context.resultUrls[sourceIndex]) {
    // Fetch the result image and convert to Uint8Array
    try {
      const fetched = await fetchImageAsUint8Array(context.resultUrls[sourceIndex]);
      sourceImageData = fetched.data;
      sourceWidth = fetched.width;
      sourceHeight = fetched.height;
    } catch (err) {
      console.error('[STYLE] Failed to fetch source image, using original:', err);
    }
  }

  const { width: outputWidth, height: outputHeight } = calculateOutputDimensions(
    sourceWidth, sourceHeight, { scale, aspectRatio },
  );

  const originalToken = context.tokenType;
  let estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, 1, 'fast');

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchRestorationCostEstimate(context.sogniClient, context.tokenType, 1, 'fast');
  }

  const sourceImageUrl = (sourceIndex !== undefined && context.resultUrls[sourceIndex]) || undefined;

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'apply_style',
    totalCount: 1,
    estimatedCost,
    sourceImageUrl,
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
