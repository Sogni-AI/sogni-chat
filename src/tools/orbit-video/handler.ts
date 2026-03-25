/**
 * Handler for orbit_video tool.
 *
 * Orchestrates a 3-step pipeline to create a 360-degree orbit video:
 * 1. Generate 4 camera angle views (front, right, back, left) via change_angle
 * 2. Generate 4 transition video clips between adjacent angles via animate_photo
 * 3. Stitch all clips into one seamless looping video via concatenateVideos
 *
 * Uses the pipeline abstraction from src/tools/shared/pipeline.ts.
 */

import type { ToolExecutionContext, ToolCallbacks } from '../types';
import type { PipelineConfig } from '../shared';
import {
  fetchImageAsUint8Array,
  preflightCreditCheck,
  formatCredits,
  executePipeline,
} from '../shared';
import { fetchAngleCostEstimate, fetchVideoCostEstimate } from '@/services/creditsService';
import { QUALITY_PRESETS } from '@/config/qualityPresets';
import { getVideoModelConfig, calculateVideoDimensions, calculateVideoFrames } from '@/constants/videoSettings';
import { concatenateVideos } from '@/utils/videoConcatenation';
import { saveVideoToGallery } from '@/services/galleryService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 4 azimuth directions that form a full orbit */
const AZIMUTHS = [
  'front view',
  'right side view',
  'back view',
  'left side view',
] as const;

const DEFAULT_ELEVATION = 'eye-level shot';
const DEFAULT_DISTANCE = 'medium shot';
const DEFAULT_PROMPT = 'constant speed linear camera pan, steady uniform motion throughout, no acceleration or deceleration';
const ORBIT_VIDEO_DURATION = 2.5; // seconds per transition clip
const ORBIT_VIDEO_MODEL = 'ltx23' as const;

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const elevation = (args.elevation as string) || DEFAULT_ELEVATION;
  const distance = (args.distance as string) || DEFAULT_DISTANCE;
  const prompt = (args.prompt as string) || DEFAULT_PROMPT;
  const rawSourceIndex = args.sourceImageIndex as number | undefined;

  // ---------------------------------------------------------------------------
  // Validate source image
  // ---------------------------------------------------------------------------
  if (!context.imageData && context.resultUrls.length === 0) {
    return JSON.stringify({ error: 'no_image', message: 'Please upload or generate an image first.' });
  }

  const useOriginal = rawSourceIndex === -1 && context.imageData !== null;
  if (rawSourceIndex !== undefined && rawSourceIndex >= 0 && rawSourceIndex >= context.resultUrls.length) {
    return JSON.stringify({
      error: 'invalid_source_index',
      message: `sourceImageIndex ${rawSourceIndex} is out of range \u2014 only ${context.resultUrls.length} results are available (0-based).`,
    });
  }

  const effectiveSourceIndex = useOriginal
    ? undefined
    : rawSourceIndex ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

  let sourceImageData = context.imageData;
  let sourceWidth = context.width;
  let sourceHeight = context.height;

  if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
    try {
      console.log(`[ORBIT] Using result image #${effectiveSourceIndex} as source`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
      sourceImageData = fetched.data;
      sourceWidth = fetched.width;
      sourceHeight = fetched.height;
    } catch (err) {
      if (!context.imageData) {
        return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the source image.' });
      }
      console.error('[ORBIT] Failed to fetch source image, using original:', err);
    }
  } else if (!context.imageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available.' });
  }

  if (!sourceImageData) {
    return JSON.stringify({ error: 'no_image', message: 'No source image available.' });
  }

  // ---------------------------------------------------------------------------
  // Cost estimation & pre-flight credit check
  // ---------------------------------------------------------------------------
  // SV3D pipeline is incompatible with Flux.2 -- fall back pro to hq
  const qualityTier = context.qualityTier === 'pro' ? 'hq' : (context.qualityTier || 'fast');
  const anglePreset = QUALITY_PRESETS[qualityTier];

  const videoConfig = getVideoModelConfig(ORBIT_VIDEO_MODEL);
  const { width: vidW, height: vidH } = calculateVideoDimensions(
    sourceWidth, sourceHeight, undefined, ORBIT_VIDEO_MODEL,
  );
  const videoFrames = calculateVideoFrames(ORBIT_VIDEO_DURATION, ORBIT_VIDEO_MODEL);

  let angleCost: number;
  let videoCost: number;
  try {
    [angleCost, videoCost] = await Promise.all([
      fetchAngleCostEstimate(
        context.sogniClient, anglePreset.model, anglePreset.steps, anglePreset.guidance, context.tokenType,
      ),
      fetchVideoCostEstimate(
        context.tokenType, videoConfig.model, vidW, vidH, videoFrames, videoConfig.fps, videoConfig.steps,
      ),
    ]);
  } catch (err) {
    console.warn('[ORBIT] Cost estimation failed, proceeding without pre-flight check:', err);
    angleCost = 0;
    videoCost = 0;
  }

  const totalAngleCost = angleCost * AZIMUTHS.length;
  const totalVideoCost = videoCost * AZIMUTHS.length;
  const estimatedCost = totalAngleCost + totalVideoCost;

  if (estimatedCost > 0) {
    const preflight = preflightCreditCheck(context, estimatedCost);
    if (!preflight.ok) return preflight.errorJson;
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'orbit_video',
    totalCount: 1,
    estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
    stepLabel: 'Preparing orbit',
  });

  // ---------------------------------------------------------------------------
  // Build pipeline
  // ---------------------------------------------------------------------------

  // Store the source image URL in the initial state data so we can reference it
  const sourceImageUrl = (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) || undefined;

  const pipelineConfig: PipelineConfig = {
    parentToolName: 'orbit_video',
    initialState: {
      imageUrls: [],
      videoUrls: [],
      data: {
        sourceImageUrl,
        sourceWidth,
        sourceHeight,
      },
    },
    steps: [
      // Step 1: Generate 4 angle views
      {
        label: 'Generating angle views',
        toolName: 'change_angle',
        count: AZIMUTHS.length,
        concurrent: true,
        buildArgs: (_state, index) => ({
          description: `${AZIMUTHS[index]} ${elevation} ${distance}`,
          // Use the original source image for each angle (not the previous angle result).
          // sourceImageIndex of -1 means "use original upload" when imageData exists,
          // otherwise use the effectiveSourceIndex we already resolved.
          sourceImageIndex: effectiveSourceIndex ?? -1,
        }),
        collectResults: (state, results) => {
          const angleImageUrls = results
            .flatMap(r => r.imageUrls)
            .filter(Boolean);
          console.log(`[ORBIT] Collected ${angleImageUrls.length} angle images`);
          return {
            ...state,
            imageUrls: angleImageUrls,
            data: { ...state.data, angleImageUrls },
          };
        },
      },

      // Step 2: Generate 4 transition clips between adjacent angles (with wrap-around)
      {
        label: 'Generating transitions',
        toolName: 'animate_photo',
        count: AZIMUTHS.length,
        concurrent: true,
        buildArgs: (state, index) => {
          const angleImageUrls = state.data.angleImageUrls as string[];
          const nextIndex = (index + 1) % AZIMUTHS.length;

          // We need to map the angle image URLs back to result indices.
          // The angle images were just added to context.resultUrls by the pipeline's
          // sub-tool calls via onToolComplete, so they should be at the end.
          // We use the URLs directly by finding their indices in context.resultUrls.
          const startResultIndex = context.resultUrls.indexOf(angleImageUrls[index]);
          const endResultIndex = context.resultUrls.indexOf(angleImageUrls[nextIndex]);

          if (startResultIndex < 0 || endResultIndex < 0) {
            console.warn(`[ORBIT] Could not resolve angle image indices (start=${startResultIndex}, end=${endResultIndex}). animate_photo will auto-select.`);
          }

          return {
            prompt,
            videoModel: ORBIT_VIDEO_MODEL,
            duration: ORBIT_VIDEO_DURATION,
            sourceImageIndex: startResultIndex >= 0 ? startResultIndex : undefined,
            endImageIndex: endResultIndex >= 0 ? endResultIndex : undefined,
            frameRole: 'both',
            numberOfVariations: 1,
          };
        },
        collectResults: (state, results) => {
          const transitionVideoUrls = results
            .flatMap(r => r.videoUrls)
            .filter(Boolean);
          console.log(`[ORBIT] Collected ${transitionVideoUrls.length} transition videos`);
          return {
            ...state,
            videoUrls: transitionVideoUrls,
          };
        },
      },

      // Step 3: Stitch all transition clips into one seamless video
      {
        label: 'Stitching orbit video',
        toolName: null,
        count: 1,
        buildArgs: () => ({}),
        customExecute: async (state, _ctx, stepCallbacks) => {
          const clipUrls = state.videoUrls;
          if (clipUrls.length < 2) {
            throw new Error(`Not enough transition clips to stitch (got ${clipUrls.length}, need at least 2)`);
          }

          console.log(`[ORBIT] Stitching ${clipUrls.length} clips`);
          const blob = await concatenateVideos(clipUrls, (progress) => {
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'orbit_video',
              progress,
              stepLabel: 'Stitching orbit video',
            });
          });

          const blobUrl = URL.createObjectURL(blob);

          // Save to gallery (fire-and-forget)
          saveVideoToGallery({ videoBlob: blob })
            .then(({ galleryImageId }) => {
              stepCallbacks.onGallerySaved?.([], [galleryImageId]);
            })
            .catch((err) => {
              console.error('[ORBIT] Failed to save orbit video to gallery:', err);
            });

          return [{
            rawResult: JSON.stringify({ success: true }),
            imageUrls: [],
            videoUrls: [blobUrl],
          }];
        },
        collectResults: (state, results) => {
          const stitchedUrls = results.flatMap(r => r.videoUrls).filter(Boolean);
          return {
            ...state,
            data: { ...state.data, finalVideoUrl: stitchedUrls[0] },
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
        error: 'orbit_failed',
        message: 'Pipeline completed but no final video was produced.',
      });
    }

    // Only emit the final stitched video — individual transition clips are
    // intermediate artifacts and would be confusing in the result grid.
    callbacks.onToolComplete('orbit_video', finalState.imageUrls, [finalVideoUrl]);

    return JSON.stringify({
      success: true,
      resultCount: 1,
      mediaType: 'video',
      creditsCost: estimatedCost > 0 ? formatCredits(estimatedCost) : undefined,
      message: `Successfully created a 360-degree orbit video with ${AZIMUTHS.length} angles and transitions.${estimatedCost > 0 ? ` Estimated cost: ~${formatCredits(estimatedCost)} credits.` : ''} The user can now see and play the orbit video.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'insufficient_credits' || message === 'no_image') {
      return JSON.stringify({ error: message, message: `Orbit pipeline aborted: ${message}` });
    }
    console.error('[ORBIT] Pipeline failed:', message);
    return JSON.stringify({ error: 'orbit_failed', message });
  }
}
