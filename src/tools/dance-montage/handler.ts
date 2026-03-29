/**
 * Handler for dance_montage tool.
 *
 * Orchestrates a multi-phase pipeline to create dance montage videos:
 * 1. Setup: resolve images, fetch dance reference video, calculate segments
 * 2. Generate clips: V2V animate-move for each segment (concurrent pipeline)
 * 3. Stitch: concatenate all clips into one video (if multi-segment)
 *
 * Uses the pipeline abstraction from src/tools/shared/pipeline.ts for
 * multi-segment generation. Single-segment (1 image, ≤20s) skips the
 * pipeline and calls V2V directly.
 */

import type { ToolExecutionContext, ToolCallbacks, UploadedFile } from '../types';
import type { PipelineConfig, StepResult } from '../shared';
import {
  fetchImageAsUint8Array,
  preflightCreditCheck,
  formatCredits,
  executePipeline,
} from '../shared';
import { toolRegistry } from '../registry';
import { fetchVideoCostEstimate } from '@/services/creditsService';
import { onRetry, cancelRetry } from '@/services/retryBus';
import { concatenateVideos } from '@/utils/videoConcatenation';
import { saveVideoToGallery } from '@/services/galleryService';
import { DANCE_PRESETS, type DancePreset } from './dances';

// ---------------------------------------------------------------------------
// Constants — WAN 2.2 Animate-Move configuration
// ---------------------------------------------------------------------------

const V2V_MODEL_ID = 'wan_v2.2-14b-fp8_animate-move_lightx2v';
const V2V_FPS = 32; // 16fps internal + post-gen frame interpolation
const V2V_INTERNAL_FPS = 16;
const V2V_STEPS = 6;

/** WAN 2.2 dimension constraints */
const DIMENSION_STEP = 16;
const MIN_DIMENSION = 480;
const MAX_DIMENSION = 1536;

/** Max duration for a single V2V clip (WAN 2.2 Animate Move supports up to 20s) */
const MAX_CLIP_DURATION = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snap a dimension to the nearest multiple of DIMENSION_STEP, clamped to min/max. */
function snapDimension(value: number): number {
  const snapped = Math.round(value / DIMENSION_STEP) * DIMENSION_STEP;
  return Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, snapped));
}

/** Calculate 9:16 output dimensions — always 480p for dance videos. */
function calculateDanceDimensions(): { width: number; height: number } {
  const w = snapDimension(480);
  const h = snapDimension(Math.round(w * (16 / 9)));
  return { width: w, height: h };
}

/** Calculate WAN 2.2 Animate Move frame count for a given duration. */
function computeFrames(duration: number): number {
  const frames = Math.round(duration * V2V_INTERNAL_FPS) + 1;
  // WAN Animate Move/Replace: up to 321 frames (20s @ 16fps)
  return Math.max(17, Math.min(321, frames));
}

/** Fetch a video from a URL and return as Uint8Array. */
async function fetchVideoAsUint8Array(
  url: string,
): Promise<{ data: Uint8Array; mimeType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Video fetch failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('Video fetch returned empty data');
    }
    return { data: new Uint8Array(buffer), mimeType: contentType };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface ResolvedImage {
  data: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  // ---------------------------------------------------------------------------
  // Phase 1: Setup
  // ---------------------------------------------------------------------------

  const danceId = args.dance as string;
  let duration = (args.duration as number) || 15;
  const rawSourceIndex = args.sourceImageIndex as number | undefined;

  // 1. Look up dance preset
  const preset: DancePreset | undefined = DANCE_PRESETS.find(p => p.id === danceId);
  if (!preset) {
    return JSON.stringify({
      error: 'invalid_dance',
      message: `Unknown dance preset "${danceId}". Check available dances in the tool description.`,
    });
  }

  console.log(`[DANCE MONTAGE] Dance: ${preset.title} (${preset.id}), requested duration: ${duration}s`);

  // 2. Resolve source images
  const imageFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'image');
  const resolvedImages: ResolvedImage[] = [];

  if (imageFiles.length > 1) {
    // Multi-image upload: use ALL uploaded image files
    for (const imgFile of imageFiles) {
      resolvedImages.push({
        data: imgFile.data,
        width: imgFile.width || 512,
        height: imgFile.height || 512,
        mimeType: imgFile.mimeType,
      });
    }
    console.log(`[DANCE MONTAGE] Using ${resolvedImages.length} uploaded images for montage`);
  } else if (rawSourceIndex !== undefined && rawSourceIndex >= 0) {
    // Use a previously generated result image
    if (rawSourceIndex >= context.resultUrls.length) {
      return JSON.stringify({
        error: 'invalid_source_index',
        message: `sourceImageIndex ${rawSourceIndex} is out of range — only ${context.resultUrls.length} results are available (0-based).`,
      });
    }
    try {
      console.log(`[DANCE MONTAGE] Fetching result image #${rawSourceIndex} as source`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[rawSourceIndex]);
      resolvedImages.push({
        data: fetched.data,
        width: fetched.width,
        height: fetched.height,
        mimeType: fetched.mimeType,
      });
    } catch (err) {
      console.error('[DANCE MONTAGE] Failed to fetch result image:', err);
      return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the source image.' });
    }
  } else if (rawSourceIndex === -1 && context.imageData) {
    // Explicit request for original uploaded image
    resolvedImages.push({
      data: context.imageData,
      width: context.width || 512,
      height: context.height || 512,
      mimeType: imageFiles[0]?.mimeType ?? 'image/jpeg',
    });
    console.log('[DANCE MONTAGE] Using original uploaded image');
  } else if (imageFiles.length === 1) {
    // Single uploaded image
    resolvedImages.push({
      data: imageFiles[0].data,
      width: imageFiles[0].width || context.width || 512,
      height: imageFiles[0].height || context.height || 512,
      mimeType: imageFiles[0].mimeType,
    });
    console.log('[DANCE MONTAGE] Using single uploaded image');
  } else if (context.imageData) {
    // Fallback to primary uploaded image data
    resolvedImages.push({
      data: context.imageData,
      width: context.width || 512,
      height: context.height || 512,
      mimeType: imageFiles[0]?.mimeType ?? 'image/jpeg',
    });
    console.log('[DANCE MONTAGE] Using primary image data');
  }

  if (resolvedImages.length === 0) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload a photo first.' });
  }

  // 3. Fetch reference dance video from CDN
  console.log(`[DANCE MONTAGE] Fetching dance reference video: ${preset.videoUrl}`);

  let danceVideoData: Uint8Array;
  let danceVideoMime: string;
  try {
    const fetched = await fetchVideoAsUint8Array(preset.videoUrl);
    danceVideoData = fetched.data;
    danceVideoMime = fetched.mimeType;
    console.log(`[DANCE MONTAGE] Dance video fetched: ${(danceVideoData.byteLength / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    console.error('[DANCE MONTAGE] Failed to fetch dance video:', err);
    return JSON.stringify({
      error: 'fetch_failed',
      message: `Could not download the "${preset.title}" dance video. Please try again.`,
    });
  }

  // 4. Calculate segments
  const imageCount = resolvedImages.length;
  const DEFAULT_SEGMENTS = 4; // Always split into 4 clips for concurrent rendering
  duration = Math.min(duration, imageCount === 1 ? 20 : 30);

  // Always use at least DEFAULT_SEGMENTS clips (concurrent = 4x speedup).
  // Ensure at least as many segments as images for full alternation.
  const segmentCount = Math.max(DEFAULT_SEGMENTS, imageCount, Math.ceil(duration / MAX_CLIP_DURATION));
  let segmentDuration = Math.round((duration / segmentCount) * 4) / 4;
  segmentDuration = Math.max(2, Math.min(MAX_CLIP_DURATION, segmentDuration));
  duration = segmentDuration * segmentCount;

  const framesPerClip = computeFrames(segmentDuration);

  // Build image alternation and video offsets
  const imageForSegment: ResolvedImage[] = [];
  const videoStartOffsets: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    imageForSegment.push(resolvedImages[i % imageCount]);
    videoStartOffsets.push(i * segmentDuration);
  }

  console.log(
    `[DANCE MONTAGE] Plan: ${segmentCount} segment(s) × ${segmentDuration}s = ${duration}s total, ` +
    `${framesPerClip} frames/clip, ${imageCount} image(s) alternating`,
  );

  // 6. Calculate output dimensions — always 9:16 480p for dance videos
  const { width, height } = calculateDanceDimensions();
  const videoAspectRatio = `${width} / ${height}`;

  console.log(`[DANCE MONTAGE] Output dimensions: ${width}x${height}`);

  // ---------------------------------------------------------------------------
  // Cost estimation & pre-flight credit check
  // ---------------------------------------------------------------------------
  let singleClipCost: number;
  try {
    singleClipCost = await fetchVideoCostEstimate(
      context.tokenType,
      V2V_MODEL_ID,
      width,
      height,
      framesPerClip,
      V2V_FPS,
      V2V_STEPS,
    );
  } catch (err) {
    console.warn('[DANCE MONTAGE] Cost estimation failed, proceeding without pre-flight check:', err);
    singleClipCost = 0;
  }

  const estimatedCost = singleClipCost * segmentCount;

  if (estimatedCost > 0) {
    const preflight = preflightCreditCheck(context, estimatedCost);
    if (!preflight.ok) return preflight.errorJson;
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'dance_montage',
    totalCount: 1,
    estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
    stepLabel: `Preparing ${preset.title} dance`,
    videoAspectRatio,
  });

  // ---------------------------------------------------------------------------
  // Phase 2: Generate clips
  // ---------------------------------------------------------------------------

  // Build the dance video UploadedFile entry for injection into V2V contexts
  const danceVideoFile: UploadedFile = {
    type: 'video',
    data: danceVideoData,
    mimeType: danceVideoMime,
    filename: `${preset.id}-reference.mp4`,
  };

  // Single-segment shortcut: skip pipeline, call V2V directly
  if (segmentCount === 1) {
    try {
      const singleContext = Object.create(context) as ToolExecutionContext;
      // Inject dance video as the video source
      singleContext.uploadedFiles = [danceVideoFile, ...imageForSegment.map((img): UploadedFile => ({
        type: 'image',
        data: img.data,
        width: img.width,
        height: img.height,
        mimeType: img.mimeType,
        filename: 'source-image.jpg',
      }))];
      // Set primary image data for V2V's fallback reference image resolution
      singleContext.imageData = imageForSegment[0].data;
      singleContext.width = imageForSegment[0].width;
      singleContext.height = imageForSegment[0].height;

      const v2vArgs: Record<string, unknown> = {
        prompt: '',
        controlMode: 'animate-move',
        duration: segmentDuration,
        numberOfVariations: 1,
        fps: V2V_FPS,
        width,
        height,
      };

      let capturedVideoUrls: string[] = [];
      const v2vCallbacks: ToolCallbacks = {
        onToolProgress: (progress) => {
          callbacks.onToolProgress({
            ...progress,
            toolName: 'dance_montage',
            stepLabel: `Generating ${preset.title} dance`,
            sourceImageUrl: undefined,
          });
        },
        onToolComplete: (_toolName, _resultUrls, videoResultUrls) => {
          capturedVideoUrls = videoResultUrls || [];
        },
        onInsufficientCredits: callbacks.onInsufficientCredits,
        onGallerySaved: undefined,
      };

      const rawResult = await toolRegistry.execute(
        'video_to_video',
        v2vArgs,
        singleContext,
        v2vCallbacks,
        { skipValidation: true },
      );

      try {
        const parsed = JSON.parse(rawResult);
        if (parsed.error) {
          return JSON.stringify({
            error: parsed.error,
            message: parsed.message || `Dance generation failed: ${parsed.error}`,
          });
        }
      } catch { /* V2V returned non-JSON — continue if we have URLs */ }

      const videoUrl = capturedVideoUrls[0];
      if (!videoUrl) {
        return JSON.stringify({
          error: 'dance_failed',
          message: 'Dance generation completed but no video was produced.',
        });
      }

      // Save to gallery
      let galleryVideoId: string | undefined;
      try {
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const { galleryImageId } = await saveVideoToGallery({ videoBlob: blob });
        galleryVideoId = galleryImageId;
      } catch (err) {
        console.error('[DANCE MONTAGE] Failed to save to gallery:', err);
      }

      callbacks.onToolComplete('dance_montage', [], [videoUrl]);

      if (galleryVideoId) {
        callbacks.onGallerySaved?.([], [galleryVideoId]);
      }

      return JSON.stringify({
        success: true,
        resultCount: 1,
        mediaType: 'video',
        dance: preset.title,
        duration: segmentDuration,
        creditsCost: estimatedCost > 0 ? formatCredits(estimatedCost) : undefined,
        message: `Successfully created a ${segmentDuration}s ${preset.title} dance video.${estimatedCost > 0 ? ` Estimated cost: ~${formatCredits(estimatedCost)} credits.` : ''} The user can now see and play the dance video.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'insufficient_credits' || message === 'no_image') {
        return JSON.stringify({ error: message, message: `Dance generation aborted: ${message}` });
      }
      console.error('[DANCE MONTAGE] Single-segment generation failed:', message);
      return JSON.stringify({ error: 'dance_failed', message });
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-segment: use pipeline
  // ---------------------------------------------------------------------------

  const pipelineConfig: PipelineConfig = {
    parentToolName: 'dance_montage',
    initialState: {
      imageUrls: [],
      videoUrls: [],
      data: {
        segmentCount,
        segmentDuration,
        preset: preset.title,
      },
    },
    steps: [
      // Step 1: Generate dance clips (concurrent)
      {
        label: 'Generating dance clips',
        toolName: 'video_to_video',
        count: segmentCount,
        concurrent: true,
        failOnAnyError: true,
        buildArgs: () => ({}),
        customExecute: async (_state, ctx, stepCallbacks) => {
          // We use customExecute instead of letting the pipeline dispatch through
          // the tool registry, because we need to inject per-invocation context
          // (different source images and the dance reference video into uploadedFiles).

          stepCallbacks.onToolProgress({
            type: 'started',
            toolName: 'dance_montage',
            totalCount: segmentCount,
            stepLabel: 'Generating dance clips',
          });

          // Emit initial per-job labels
          for (let j = 0; j < segmentCount; j++) {
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'dance_montage',
              stepLabel: 'Generating dance clips',
              jobLabel: `Clip ${j + 1} of ${segmentCount}`,
              jobIndex: j,
              totalCount: segmentCount,
              completedCount: 0,
            });
          }

          const slotResults: StepResult[] = new Array(segmentCount).fill(null).map(() => ({
            rawResult: '',
            imageUrls: [],
            videoUrls: [],
          }));
          let completedCount = 0;

          // Generate a single clip — used for both initial run and retries
          const generateClip = (i: number): Promise<void> => {
            const invocationContext = Object.create(ctx) as ToolExecutionContext;
            const segmentImage = imageForSegment[i];
            invocationContext.uploadedFiles = [danceVideoFile, {
              type: 'image',
              data: segmentImage.data,
              width: segmentImage.width,
              height: segmentImage.height,
              mimeType: segmentImage.mimeType,
              filename: `source-image-${i}.jpg`,
            }];
            invocationContext.imageData = segmentImage.data;
            invocationContext.width = segmentImage.width;
            invocationContext.height = segmentImage.height;

            const wrappedCallbacks: ToolCallbacks = {
              onToolProgress: (progress) => {
                if (progress.type === 'started') return;
                stepCallbacks.onToolProgress({
                  ...progress,
                  toolName: 'dance_montage',
                  stepLabel: 'Generating dance clips',
                  jobLabel: `Clip ${i + 1} of ${segmentCount}`,
                  jobIndex: i,
                  totalCount: segmentCount,
                  completedCount,
                  videoResultUrls: undefined,
                  sourceImageUrl: undefined,
                });
              },
              onToolComplete: (_toolName, resultUrls, videoResultUrls) => {
                completedCount++;
                slotResults[i] = {
                  ...slotResults[i],
                  imageUrls: resultUrls || [],
                  videoUrls: videoResultUrls || [],
                };
                for (const url of (videoResultUrls || [])) {
                  if (!ctx.videoResultUrls.includes(url)) ctx.videoResultUrls.push(url);
                }
              },
              onInsufficientCredits: stepCallbacks.onInsufficientCredits,
              onGallerySaved: undefined,
            };

            return toolRegistry.execute(
              'video_to_video',
              {
                prompt: '',
                controlMode: 'animate-move',
                duration: segmentDuration,
                videoStartOffset: videoStartOffsets[i],
                numberOfVariations: 1,
                fps: V2V_FPS,
                width,
                height,
              },
              invocationContext,
              wrappedCallbacks,
              { skipValidation: true },
            ).then((rawResult) => {
              slotResults[i].rawResult = rawResult;
              try {
                const parsed = JSON.parse(rawResult);
                if (parsed.error) {
                  throw new Error(parsed.message || parsed.error);
                }
              } catch (e) {
                if (!(e instanceof SyntaxError)) throw e;
              }
            });
          };

          // Run all clips concurrently
          const settled = await Promise.allSettled(
            Array.from({ length: segmentCount }, (_, i) => generateClip(i)),
          );

          // Identify failed clips
          let failedIndices = settled
            .map((r, i) => r.status === 'rejected' ? i : -1)
            .filter(i => i >= 0);

          if (failedIndices.length === segmentCount) {
            const firstErr = settled[0].status === 'rejected' ? settled[0].reason : 'Unknown error';
            throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
          }

          // Per-clip retry loop: show retry buttons, wait for user, retry individually
          const retryKeys: string[] = [];
          while (failedIndices.length > 0) {
            if (ctx.signal?.aborted) throw new Error('Cancelled');

            // Emit failed state with retry keys for each failed clip
            for (const i of failedIndices) {
              const key = `${ctx.sessionId}-dance-clip-${i}-${Date.now()}`;
              retryKeys.push(key);

              stepCallbacks.onToolProgress({
                type: 'progress',
                toolName: 'dance_montage',
                stepLabel: 'Generating dance clips',
                jobIndex: i,
                totalCount: segmentCount,
                completedCount,
                perJobProgress: {
                  [i]: {
                    error: `Clip ${i + 1} failed`,
                    label: `Clip ${i + 1} of ${segmentCount}`,
                    retryKey: key,
                  },
                },
              });
            }

            console.log(`[DANCE MONTAGE] Waiting for user retry on clips: ${failedIndices.map(i => i + 1).join(', ')}`);

            // Wait for ANY retry button click, then retry that clip
            const retryIndex = await Promise.race(
              failedIndices.map(i => {
                const key = retryKeys.find(k => k.includes(`-clip-${i}-`))!;
                return onRetry(key).then(() => i);
              }),
            );

            // Clean up all pending retry listeners for this round
            for (const key of retryKeys) cancelRetry(key);
            retryKeys.length = 0;

            console.log(`[DANCE MONTAGE] User triggered retry for clip ${retryIndex + 1}`);

            // Reset progress for the retrying clip
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'dance_montage',
              stepLabel: 'Generating dance clips',
              jobIndex: retryIndex,
              totalCount: segmentCount,
              completedCount,
              perJobProgress: {
                [retryIndex]: {
                  progress: 0,
                  label: `Retrying clip ${retryIndex + 1}...`,
                  error: undefined,
                  retryKey: undefined,
                },
              },
            });

            // Retry the single failed clip
            const retryResult = await Promise.allSettled([generateClip(retryIndex)]);
            if (retryResult[0].status === 'fulfilled') {
              failedIndices = failedIndices.filter(i => i !== retryIndex);
            }
            // If retry failed again, loop continues — shows retry button again
          }

          return slotResults;
        },
        collectResults: (state, results) => {
          const clipVideoUrls = results
            .flatMap(r => r.videoUrls)
            .filter(Boolean);

          if (clipVideoUrls.length !== segmentCount) {
            console.warn(
              `[DANCE MONTAGE] Expected ${segmentCount} clip videos but got ${clipVideoUrls.length}`,
            );
          }

          console.log(`[DANCE MONTAGE] Collected ${clipVideoUrls.length} dance clips`);
          return {
            ...state,
            videoUrls: clipVideoUrls,
          };
        },
      },

      // Step 2: Stitch all clips into one dance montage video
      {
        label: 'Stitching dance montage',
        toolName: null,
        count: 1,
        buildArgs: () => ({}),
        customExecute: async (pipelineState, _ctx, stepCallbacks) => {
          const clipUrls = pipelineState.videoUrls;
          if (clipUrls.length < 2) {
            throw new Error(`Not enough clips to stitch (got ${clipUrls.length}, need at least 2)`);
          }

          console.log(`[DANCE MONTAGE] Stitching ${clipUrls.length} clips`);
          const blob = await concatenateVideos(clipUrls, (progress) => {
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'dance_montage',
              progress,
              stepLabel: 'Stitching dance montage',
            });
          });

          const blobUrl = URL.createObjectURL(blob);

          // Save to gallery
          let galleryVideoId: string | undefined;
          try {
            const { galleryImageId } = await saveVideoToGallery({ videoBlob: blob });
            galleryVideoId = galleryImageId;
          } catch (err) {
            console.error('[DANCE MONTAGE] Failed to save montage video to gallery:', err);
          }

          return [{
            rawResult: JSON.stringify({ success: true, galleryVideoId }),
            imageUrls: [],
            videoUrls: [blobUrl],
          }];
        },
        collectResults: (state, results) => {
          const stitchedUrls = results.flatMap(r => r.videoUrls).filter(Boolean);
          let galleryVideoId: string | undefined;
          try {
            galleryVideoId = JSON.parse(results[0]?.rawResult || '{}').galleryVideoId;
          } catch { /* ignore */ }
          return {
            ...state,
            data: { ...state.data, finalVideoUrl: stitchedUrls[0], stitchedGalleryId: galleryVideoId },
          };
        },
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Execute pipeline
  // ---------------------------------------------------------------------------
  try {
    const finalState = await executePipeline(pipelineConfig, context, callbacks);
    const finalVideoUrl = finalState.data.finalVideoUrl as string | undefined;

    if (!finalVideoUrl) {
      return JSON.stringify({
        error: 'dance_failed',
        message: 'Pipeline completed but no final video was produced.',
      });
    }

    // Emit only the final stitched video
    callbacks.onToolComplete('dance_montage', [], [finalVideoUrl]);

    const stitchedGalleryId = finalState.data.stitchedGalleryId as string | undefined;
    if (stitchedGalleryId) {
      callbacks.onGallerySaved?.([], [stitchedGalleryId]);
    }

    return JSON.stringify({
      success: true,
      resultCount: 1,
      mediaType: 'video',
      dance: preset.title,
      duration,
      segments: segmentCount,
      creditsCost: estimatedCost > 0 ? formatCredits(estimatedCost) : undefined,
      message: `Successfully created a ${duration}s ${preset.title} dance montage with ${segmentCount} clips.${estimatedCost > 0 ? ` Estimated cost: ~${formatCredits(estimatedCost)} credits.` : ''} The user can now see and play the dance montage.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'insufficient_credits' || message === 'no_image') {
      return JSON.stringify({ error: message, message: `Dance montage aborted: ${message}` });
    }
    console.error('[DANCE MONTAGE] Pipeline failed:', message);
    return JSON.stringify({ error: 'dance_failed', message });
  }
}
