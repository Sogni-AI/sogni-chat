/**
 * Handler for animate_photo tool.
 * Extracted from the superapp's chatService.ts executeAnimatePhoto.
 *
 * This is the most complex tool handler — it includes:
 * - Vision LLM sub-calls for scene description (LTX-2)
 * - Dialogue refinement via thinking mode (LTX-2, long videos)
 * - Video generation with per-job progress tracking
 * - Per-job gallery saves (fire-and-forget)
 * - Transient error retry (workerDisconnected)
 */

import type { SogniClient } from '@sogni-ai/sogni-client';
import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { ToolExecutionContext, ToolCallbacks } from '../types';
import type { TokenType } from '@/types/wallet';
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
  uint8ArrayToDataUri,
} from '../shared';
import { generateVideo } from '@/services/sdk/videoGeneration';
import { fetchVideoCostEstimate } from '@/services/creditsService';
import { getVideoModelConfig, calculateVideoDimensions, calculateVideoFrames, type VideoModelId } from '@/constants/videoSettings';
import { saveVideoToGallery } from '@/services/galleryService';
import { CHAT_MODEL } from '@/config/chat';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Detect if a prompt contains quoted dialogue (text in quotes) */
function hasDialogue(prompt: string): boolean {
  // Match double or single quoted strings that look like speech
  return /["'].{3,}["']/.test(prompt);
}

/** System prompt for the /describe vision call used to anchor LTX-2 video prompts */
const VIDEO_DESCRIBE_SYSTEM_PROMPT =
  'Describe this image in 2-3 dense present-tense sentences for a video generation model. ' +
  'Include: subject identity, appearance, clothing, pose, expression, environment, lighting, surface textures, and colors. ' +
  'Be concrete and specific — name materials, colors, light sources. ' +
  'Do NOT mention what to animate or any motion. Just describe the static scene exactly as it appears.';

/**
 * Use the LLM with thinking mode to generate or refine dialogue for video prompts.
 * Thinking mode helps the model produce more natural, well-paced dialogue,
 * especially for longer videos where dialogue needs to span the duration.
 */
async function refineDialogueWithThinking(
  sogniClient: SogniClient,
  originalPrompt: string,
  duration: number,
  tokenType: TokenType,
): Promise<string> {
  try {
    console.log(`[ANIMATE] Refining dialogue with thinking mode (${duration}s video)`);

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You refine video prompts that contain dialogue. Your job is to improve the dialogue and action pacing for a ${duration}-second video clip. Rules:
- Keep all quoted dialogue in double quotes
- Space dialogue naturally across the ${duration}s duration using temporal cues ("begins by saying...", "then turns and says...", "after a pause, responds with...")
- Add natural pauses, gestures, and expressions between lines
- Preserve the user's intended meaning and any specific quoted words exactly
- Include audio/sound descriptions (ambient sounds, tone of voice)
- Return ONLY the refined prompt, no explanation`,
      },
      {
        role: 'user',
        content: `Refine this video prompt for a ${duration}-second clip:\n\n${originalPrompt}`,
      },
    ];

    const stream = await sogniClient.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      stream: true,
      tokenType,
      temperature: 0.7,
      max_tokens: 16384,
      think: true,
    });

    let refined = '';
    let insideThink = false;
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: still } = stripThinkBlocks(chunk.content, insideThink);
        insideThink = still;
        if (cleaned) refined += cleaned;
      }
    }

    refined = refined.trim();
    if (refined.length > 20) {
      console.log(`[ANIMATE] Dialogue refined (${refined.length} chars):`, refined);
      return refined;
    }

    // Fallback to original if refinement failed
    console.warn(`[CHAT SERVICE] Dialogue refinement too short (${refined.length} chars), using original prompt. Refined result was:`, refined || '(empty)');
    return originalPrompt;
  } catch (err) {
    console.error('[ANIMATE] Dialogue refinement failed, using original prompt:', err);
    return originalPrompt;
  }
}

/**
 * Use the vision LLM to describe a source image in detail for LTX-2 video prompting.
 * Returns a rich scene description that anchors the video to the first frame.
 * Falls back to empty string on failure (video will still generate, just with weaker anchoring).
 */
async function describeImageForVideo(
  sogniClient: SogniClient,
  imageData: Uint8Array,
  tokenType: TokenType,
): Promise<string> {
  try {
    const dataUri = uint8ArrayToDataUri(imageData);

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
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: still } = stripThinkBlocks(chunk.content, insideThink);
        insideThink = still;
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
  const rawVideoModel = (args.videoModel as string) || 'ltx2';
  const validVideoModels: VideoModelId[] = ['ltx2', 'wan22', 'ltx2-hq', 'wan22-hq', 'ltx23'];
  const videoModelId: VideoModelId = validVideoModels.includes(rawVideoModel as VideoModelId)
    ? (rawVideoModel as VideoModelId)
    : 'ltx2';
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const aspectRatio = args.aspectRatio as string | undefined;
  const isLTX = videoModelId.startsWith('ltx');

  if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload an image first.' });
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
  const useOriginal = rawSourceIndex === -1;
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

  let sourceImageData: Uint8Array = context.imageData;
  let sourceWidth = context.width;
  let sourceHeight = context.height;

  if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
    try {
      console.log(`[ANIMATE] Animating result image #${effectiveSourceIndex} (${rawSourceIndex === undefined ? 'auto-selected latest' : 'user-specified'}): ${context.resultUrls[effectiveSourceIndex]}`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
      sourceImageData = fetched.data;
      sourceWidth = fetched.width;
      sourceHeight = fetched.height;
      console.log(`[ANIMATE] Successfully fetched result image: ${sourceWidth}x${sourceHeight}, ${sourceImageData.length} bytes`);
    } catch (err) {
      console.error('[ANIMATE] Failed to fetch source image for animation, using original:', err);
    }
  } else {
    console.log(`[ANIMATE] Using original uploaded image for animation (no results available or explicit original)`);
  }

  // Pre-compute video dimensions for aspect ratio (used in all progress callbacks)
  const { width: vidW, height: vidH } = calculateVideoDimensions(sourceWidth, sourceHeight, targetResolution, videoModelId, aspectRatio);
  const videoAspectRatio = `${vidW} / ${vidH}`;

  // Compose the final video prompt based on model
  let composedPrompt: string;
  if (isLTX) {
    // Step 1: Use vision LLM to describe the source image for rich first-frame anchoring
    callbacks.onToolProgress({
      type: 'started',
      toolName: 'animate_photo',
      totalCount: numberOfMedia,
      stepLabel: 'Analyzing image',
      videoAspectRatio,
    });
    console.log('[ANIMATE] Describing source image for LTX-2 video prompt...');
    const sceneDescription = await withTimeout(
      describeImageForVideo(context.sogniClient, sourceImageData, context.tokenType),
      LLM_SUBCALL_TIMEOUT_MS,
      'Image description',
    ) ?? '';

    // Step 2: For prompts with dialogue in longer videos, use thinking mode to refine pacing
    let refinedPrompt = prompt;
    if (hasDialogue(prompt) && duration > 10) {
      callbacks.onToolProgress({
        type: 'started',
        toolName: 'animate_photo',
        totalCount: numberOfMedia,
        stepLabel: 'Refining dialogue',
        videoAspectRatio,
      });
      refinedPrompt = await withTimeout(
        refineDialogueWithThinking(context.sogniClient, prompt, duration, context.tokenType),
        LLM_SUBCALL_TIMEOUT_MS,
        'Dialogue refinement',
      ) ?? prompt;
    }

    composedPrompt = sceneDescription
      ? `A cinematic scene of ${sceneDescription} ${refinedPrompt}`
      : `A cinematic scene of ${refinedPrompt}`;
  } else {
    // WAN 2.2: Use the prompt directly — no scene description or cinematic prefix
    composedPrompt = prompt;
  }
  console.log(`[ANIMATE] Video prompt (${videoModelId}, ${composedPrompt.length} chars):`, composedPrompt);
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
    stepLabel: 'Starting generation',
    videoAspectRatio,
  });

  // Per-job progress/ETA maps to prevent crossover between concurrent jobs
  const perJobProgress = new Map<number, number>();
  const perJobEta = new Map<number, number>();
  // Track per-job gallery saves so we don't double-save
  const gallerySavedUrls = new Set<string>();
  const sourceImageBlob = new Blob([sourceImageData as BlobPart], { type: 'image/jpeg' });

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

  const runVideoGeneration = (tokenType: TokenType) => generateVideo(
    context.sogniClient,
    {
      imageData: sourceImageData,
      width: sourceWidth,
      height: sourceHeight,
      tokenType,
      prompt: composedPrompt,
      duration,
      videoModelId,
      numberOfMedia,
      aspectRatio,
      targetResolution,
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
      message: `Successfully generated ${videoUrls.length} ${duration}-second video${videoUrls.length !== 1 ? 's' : ''} using ${isLTX ? 'LTX-2' : 'WAN 2.2'}${isLTX ? ' (with audio)' : ''}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see and play the video${videoUrls.length !== 1 ? 's' : ''}.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for video generation.' });
    }
    throw err;
  }
}
