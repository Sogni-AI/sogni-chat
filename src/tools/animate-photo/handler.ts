/**
 * Handler for animate_photo tool.
 * Extracted from the superapp's chatService.ts executeAnimatePhoto.
 *
 * This is the most complex tool handler — it includes:
 * - Vision LLM sub-calls for scene description (LTX 2.3)
 * - Creative prompt refinement via thinking mode (LTX 2.3)
 * - Video generation with per-job progress tracking
 * - Per-job gallery saves (fire-and-forget)
 * - Transient error retry (workerDisconnected)
 */

import type { SogniClient } from '@sogni-ai/sogni-client';
import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { ToolExecutionContext, ToolCallbacks } from '../types';
import type { TokenType } from '@/types/wallet';
import { resizeUint8ArrayForVision } from '@/utils/imageProcessing';
import {
  fetchImageAsUint8Array,
  preflightCreditCheck,
  tryWithTokenFallback,
  isInsufficientCreditsError,
  registerPendingCost,
  recordCompletion,
  discardPending,
  formatCredits,
  withTimeout,
  stripThinkBlocks,
  LLM_SUBCALL_TIMEOUT_MS,
  LLM_THINKING_TIMEOUT_MS,
  needsCreativeRefinement,
  refineVideoPrompt,
} from '../shared';
import { generateVideo } from '@/services/sdk/videoGeneration';
import { fetchVideoCostEstimate } from '@/services/creditsService';
import { getVideoModelConfig, calculateVideoDimensions, calculateVideoFrames, type VideoModelId } from '@/constants/videoSettings';
import { saveVideoToGallery } from '@/services/galleryService';
import { CHAT_MODEL } from '@/config/chat';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** System prompt for the /describe vision call used to anchor LTX 2.3 video prompts */
const VIDEO_DESCRIBE_SYSTEM_PROMPT =
  'Describe this image in 2-3 dense present-tense sentences for a video generation model. ' +
  'Include: subject identity, appearance, clothing, pose, expression, environment, lighting, surface textures, and colors. ' +
  'Be concrete and specific — name materials, colors, light sources. ' +
  'Do NOT mention what to animate or any motion. Just describe the static scene exactly as it appears.';

/**
 * Use the vision LLM to describe a source image in detail for LTX 2.3 video prompting.
 * Returns a rich scene description that anchors the video to the first frame.
 * Falls back to empty string on failure (video will still generate, just with weaker anchoring).
 */
async function describeImageForVideo(
  sogniClient: SogniClient,
  imageData: Uint8Array,
  tokenType: TokenType,
): Promise<string> {
  try {
    const dataUri = await resizeUint8ArrayForVision(imageData);

    const messages: ChatMessage[] = [
      { role: 'system', content: VIDEO_DESCRIBE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri } },
          { type: 'text', text: 'Describe this image.' },
        ],
      },
    ];

    const stream = await sogniClient.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      stream: true,
      tokenType,
      temperature: 0.3,
      max_tokens: 512,
      think: false,
    });

    let description = '';
    let insideThink = false;
    let insideToolCall = false;
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: stillThink, insideToolCall: stillToolCall } = stripThinkBlocks(chunk.content, insideThink, insideToolCall);
        insideThink = stillThink;
        insideToolCall = stillToolCall;
        if (cleaned) description += cleaned;
      }
    }

    description = description.trim();
    console.log(`[ANIMATE] Video scene description (${description.length} chars):`, description);
    return description;
  } catch (err) {
    console.error('[ANIMATE] Failed to describe image for video, proceeding without:', err);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  const rawSourceIndex = args.sourceImageIndex as number | undefined;
  const duration = Math.max(2, Math.min(20, (args.duration as number) || 5));
  const rawVideoModel = (args.videoModel as string) || 'ltx23';
  const validVideoModels: VideoModelId[] = ['ltx23', 'wan22'];
  const videoModelId: VideoModelId = validVideoModels.includes(rawVideoModel as VideoModelId)
    ? (rawVideoModel as VideoModelId)
    : 'ltx23';
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const aspectRatio = args.aspectRatio as string | undefined;
  const frameRole = (args.frameRole as 'start' | 'end' | 'both' | undefined) ?? 'start';
  const rawEndImageIndex = args.endImageIndex as number | undefined;
  const isLTX = videoModelId.startsWith('ltx');

  if (!context.imageData && context.resultUrls.length === 0) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload or generate an image first.' });
  }

  // Quality-based resolution: Standard (fast) -> 720p (768), High (hq) -> 1080p (1088)
  const qualityTier = context.qualityTier || 'fast';
  const targetResolution = isLTX
    ? (qualityTier === 'hq' ? 1088 : 768)
    : undefined;

  // Determine source image:
  // - sourceImageIndex === -1 -> explicitly use original
  // - sourceImageIndex === undefined -> auto-select latest result (or original if none)
  // - sourceImageIndex >= 0 -> use that specific result
  const useOriginal = rawSourceIndex === -1 && context.imageData !== null;
  const effectiveSourceIndex = useOriginal
    ? undefined
    : rawSourceIndex ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

  console.log(`[ANIMATE] source selection:`, {
    rawSourceIndex,
    useOriginal,
    effectiveSourceIndex,
    availableResultCount: context.resultUrls.length,
    resultUrls: context.resultUrls,
  });

  let sourceImageData = context.imageData;
  let sourceWidth = context.width;
  let sourceHeight = context.height;
  // Track MIME type: fetchImageAsUint8Array returns actual content type; uploads preserve original
  let sourceImageMime = context.uploadedFiles.find(f => f.type === 'image')?.mimeType ?? 'image/jpeg';

  if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
    try {
      console.log(`[ANIMATE] Animating result image #${effectiveSourceIndex} (${rawSourceIndex === undefined ? 'auto-selected latest' : 'user-specified'}): ${context.resultUrls[effectiveSourceIndex]}`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
      sourceImageData = fetched.data;
      sourceWidth = fetched.width;
      sourceHeight = fetched.height;
      sourceImageMime = fetched.mimeType;
      console.log(`[ANIMATE] Successfully fetched result image: ${sourceWidth}x${sourceHeight}, ${sourceImageData.length} bytes`);
    } catch (err) {
      if (!context.imageData) {
        return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the previously generated image for animation.' });
      }
      console.error('[ANIMATE] Failed to fetch source image for animation, using original:', err);
    }
  } else if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available for animation.' });
  } else {
    console.log(`[ANIMATE] Using original uploaded image for animation (no results available or explicit original)`);
  }

  if (!sourceImageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available for animation.' });
  }

  // ---------------------------------------------------------------------------
  // Resolve end frame image (for "end" and "both" modes)
  // ---------------------------------------------------------------------------
  let endImageData: Uint8Array | null = null;

  if (frameRole === 'end') {
    // User's image IS the end frame — it will be sent as referenceImageEnd only.
    // sourceImageData is still used for vision description (LTX 2.3 prompt anchoring)
    // so the prompt describes what the video converges toward.
    endImageData = sourceImageData;
  } else if (frameRole === 'both') {
    // Resolve end frame from endImageIndex, uploaded files, or second uploaded image
    if (rawEndImageIndex === -1 && context.imageData) {
      // Explicit: use primary uploaded image as end frame
      endImageData = context.imageData;
    } else if (rawEndImageIndex !== undefined && rawEndImageIndex >= 0 && context.resultUrls[rawEndImageIndex]) {
      // Use a specific result image as end frame
      try {
        const fetched = await fetchImageAsUint8Array(context.resultUrls[rawEndImageIndex]);
        endImageData = fetched.data;
        console.log(`[ANIMATE] End frame from result #${rawEndImageIndex}: ${fetched.width}x${fetched.height}`);
      } catch (err) {
        console.error('[ANIMATE] Failed to fetch end frame image:', err);
        return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the end frame image.' });
      }
    } else {
      // Auto: look for a second uploaded image
      const imageFiles = context.uploadedFiles.filter(f => f.type === 'image');
      if (imageFiles.length >= 2) {
        endImageData = imageFiles[1].data;
        console.log(`[ANIMATE] End frame from second uploaded image: ${imageFiles[1].filename}`);
      } else {
        return JSON.stringify({ error: 'missing_end_frame', message: 'frameRole is "both" but no end frame image was found. Please upload a second image or specify endImageIndex.' });
      }
    }
  }

  console.log(`[ANIMATE] Frame role: ${frameRole}, hasEndImage: ${!!endImageData}`);

  // Pre-compute video dimensions for aspect ratio (used in all progress callbacks)
  const { width: vidW, height: vidH } = calculateVideoDimensions(sourceWidth, sourceHeight, targetResolution, videoModelId, aspectRatio);
  const videoAspectRatio = `${vidW} / ${vidH}`;
  const mediaLabel = `${isLTX ? 'LTX 2.3' : 'WAN 2.2'} — ${duration}s @ ${vidW}x${vidH}`;

  // Compose the final video prompt based on model
  let composedPrompt: string;
  if (isLTX) {
    // Step 1: Use vision LLM to describe the source image for rich frame anchoring
    // (applies to both first-frame and last-frame modes)
    callbacks.onToolProgress({
      type: 'started',
      toolName: 'animate_photo',
      totalCount: numberOfMedia,
      stepLabel: 'Analyzing image',
      videoAspectRatio,
      modelName: mediaLabel,
    });
    console.log(`[ANIMATE] Describing source image for LTX 2.3 video prompt (frameRole=${frameRole})...`);
    const sceneDescription = await withTimeout(
      describeImageForVideo(context.sogniClient, sourceImageData, context.tokenType),
      LLM_SUBCALL_TIMEOUT_MS,
      'Image description',
    ) ?? '';

    // Step 2: For prompts needing creative expansion (dialogue, characters, narrative),
    // use thinking mode to generate a detailed, production-quality prompt
    let refinedPrompt = prompt;
    if (needsCreativeRefinement(prompt, duration)) {
      callbacks.onToolProgress({
        type: 'started',
        toolName: 'animate_photo',
        totalCount: numberOfMedia,
        stepLabel: 'Crafting detailed prompt',
        videoAspectRatio,
        modelName: mediaLabel,
      });
      refinedPrompt = await withTimeout(
        refineVideoPrompt(context.sogniClient, prompt, duration, context.tokenType, '[ANIMATE]', context.signal),
        LLM_THINKING_TIMEOUT_MS,
        'Video prompt refinement',
      ) ?? prompt;
    }

    if (frameRole === 'end') {
      // End-frame mode: describe the motion that leads TO the target image
      composedPrompt = sceneDescription
        ? `${refinedPrompt} The scene resolves to ${sceneDescription}`
        : refinedPrompt;
    } else {
      composedPrompt = sceneDescription
        ? `A cinematic scene of ${sceneDescription} ${refinedPrompt}`
        : `A cinematic scene of ${refinedPrompt}`;
    }
  } else {
    // WAN 2.2: Use the prompt directly — no scene description or cinematic prefix
    composedPrompt = prompt;
  }
  console.log(`[ANIMATE] Video prompt (${videoModelId}, frameRole=${frameRole}, ${composedPrompt.length} chars):`, composedPrompt);
  console.log(`[ANIMATE] Video quality: ${qualityTier} -> ${targetResolution ? `${targetResolution}p shorter side` : 'default resolution'}`);

  // Estimate video cost using the selected model config
  const videoConfig = getVideoModelConfig(videoModelId);
  const videoFrames = calculateVideoFrames(duration, videoModelId);
  const originalToken = context.tokenType;
  let singleVideoCost = await fetchVideoCostEstimate(
    context.tokenType, videoConfig.model, vidW, vidH, videoFrames, videoConfig.fps, videoConfig.steps,
  );
  let estimatedCost = singleVideoCost * numberOfMedia;

  // Pre-flight credit check before creating placeholders
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    singleVideoCost = await fetchVideoCostEstimate(
      context.tokenType, videoConfig.model, vidW, vidH, videoFrames, videoConfig.fps, videoConfig.steps,
    );
    estimatedCost = singleVideoCost * numberOfMedia;
  }

  const sourceImageUrl = (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) || undefined;

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'animate_photo',
    totalCount: numberOfMedia,
    estimatedCost,
    sourceImageUrl,
    stepLabel: 'Generating video',
    videoAspectRatio,
    modelName: mediaLabel,
  });

  // Per-job progress/ETA maps to prevent crossover between concurrent jobs
  const perJobProgress = new Map<number, number>();
  const perJobEta = new Map<number, number>();
  // Track per-job gallery saves so we don't double-save
  const gallerySavedUrls = new Set<string>();
  const sourceImageBlob = new Blob([sourceImageData as BlobPart], { type: sourceImageMime });

  // Save a single video to gallery and notify UI immediately (fire-and-forget)
  const saveVideoPerJob = (videoUrl: string) => {
    if (gallerySavedUrls.has(videoUrl)) return;
    gallerySavedUrls.add(videoUrl);
    saveVideoToGallery({
      videoUrl,
      sourceImageBlob,
      sourceWidth,
      sourceHeight,
      prompt,
      duration,
    }).then(({ galleryImageId }) => {
      callbacks.onGallerySaved?.([], [galleryImageId]);
    }).catch(err => {
      console.error('[ANIMATE] Failed to save video to gallery:', err);
    });
  };

  // For "end" mode: don't send the image as start frame (referenceImage),
  // only as end frame (referenceImageEnd)
  const startImageData = frameRole === 'end' ? null : sourceImageData;

  const runVideoGeneration = (tokenType: TokenType) => generateVideo(
    context.sogniClient,
    {
      imageData: startImageData,
      width: sourceWidth,
      height: sourceHeight,
      tokenType,
      prompt: composedPrompt,
      imageMimeType: sourceImageMime,
      duration,
      videoModelId,
      numberOfMedia,
      aspectRatio,
      targetResolution,
      disableNSFWFilter: context.safeContentFilter === false,
      ...(endImageData ? { endImageData } : {}),
      ...(frameRole === 'end' ? { firstFrameStrength: 0, lastFrameStrength: 0.9 } : {}),
    },
    (progress) => {
      if (progress.type === 'progress' || progress.type === 'completed') {
        if (progress.jobIndex !== undefined && progress.progress !== undefined) {
          perJobProgress.set(progress.jobIndex, progress.progress);
        }
        callbacks.onToolProgress({
          type: progress.completedCount !== undefined && progress.completedCount >= numberOfMedia ? 'completed' : 'progress',
          toolName: 'animate_photo',
          progress: progress.progress,
          completedCount: progress.completedCount,
          totalCount: numberOfMedia,
          jobIndex: progress.jobIndex,
          videoResultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
          etaSeconds: progress.jobIndex !== undefined ? perJobEta.get(progress.jobIndex) : undefined,
          estimatedCost,
          sourceImageUrl,
          videoAspectRatio,
        });
        // Save completed video to gallery immediately (don't wait for batch to finish)
        if (progress.type === 'completed' && progress.resultUrl) {
          saveVideoPerJob(progress.resultUrl);
        }
      }
      if (progress.type === 'jobETA') {
        if (progress.jobIndex !== undefined && progress.etaSeconds !== undefined) {
          perJobEta.set(progress.jobIndex, progress.etaSeconds);
        }
        callbacks.onToolProgress({
          type: 'progress',
          toolName: 'animate_photo',
          progress: progress.jobIndex !== undefined ? perJobProgress.get(progress.jobIndex) : undefined,
          completedCount: progress.completedCount,
          totalCount: numberOfMedia,
          jobIndex: progress.jobIndex,
          etaSeconds: progress.etaSeconds,
          estimatedCost,
          sourceImageUrl,
          videoAspectRatio,
        });
      }
      // Per-job failure — notify UI so the failed slot updates in real time.
      // Use type:'progress' (not 'error') so the error appears per-slot via perJobProgress,
      // rather than triggering the global error screen in ChatProgressIndicator.
      if (progress.type === 'error' && progress.jobIndex !== undefined) {
        callbacks.onToolProgress({
          type: 'progress',
          toolName: 'animate_photo',
          completedCount: progress.completedCount,
          totalCount: numberOfMedia,
          jobIndex: progress.jobIndex,
          error: progress.error,
          estimatedCost,
          sourceImageUrl,
          videoAspectRatio,
        });
      }
    },
    context.signal,
    context.sessionId,
  );

  const billingId = estimatedCost > 0
    ? registerPendingCost('animate_photo', estimatedCost, context.tokenType)
    : null;

  try {
    let videoUrls: string[];
    try {
      videoUrls = await tryWithTokenFallback(runVideoGeneration, context, estimatedCost);
    } catch (retryErr: unknown) {
      // Retry once on transient worker errors (e.g. workerDisconnected)
      const msg = ((retryErr as Error).message || '').toLowerCase();
      const isTransient = msg.includes('worker disconnected') || msg.includes('workerdisconnected');
      if (!isTransient || isInsufficientCreditsError(retryErr)) throw retryErr;

      console.warn('[ANIMATE] Transient video error, retrying once:', (retryErr as Error).message);
      if (context.signal?.aborted) throw retryErr;
      perJobProgress.clear();
      perJobEta.clear();
      gallerySavedUrls.clear();
      callbacks.onToolProgress({
        type: 'started',
        toolName: 'animate_photo',
        totalCount: numberOfMedia,
        estimatedCost,
        sourceImageUrl,
        stepLabel: 'Retrying generation',
        modelName: mediaLabel,
      });
      videoUrls = await tryWithTokenFallback(runVideoGeneration, context, estimatedCost);
    }

    if (billingId) void recordCompletion(billingId);

    // Pass video URLs via the videoResultUrls channel
    callbacks.onToolComplete('animate_photo', [], videoUrls);

    // Save any videos not already saved per-job (catch-up for edge cases)
    for (const videoUrl of videoUrls) {
      saveVideoPerJob(videoUrl);
    }

    return JSON.stringify({
      success: true,
      resultCount: videoUrls.length,
      mediaType: 'video',
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${videoUrls.length} ${duration}-second video${videoUrls.length !== 1 ? 's' : ''} using ${isLTX ? 'LTX 2.3' : 'WAN 2.2'}${isLTX ? ' (with audio)' : ''}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see and play the video${videoUrls.length !== 1 ? 's' : ''}.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for video generation.' });
    }
    throw err;
  }
}
