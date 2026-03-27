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

/** Generated azimuths — the original image serves as "front view" */
const GENERATED_AZIMUTHS = [
  'right side view',
  'back view',
  'left side view',
] as const;

/** Total transition count: original→right, right→back, back→left, left→original */
const TRANSITION_COUNT = 4;

const DEFAULT_ELEVATION = 'eye-level shot';
const DEFAULT_DISTANCE = 'medium shot';
const DEFAULT_PROMPT = 'constant speed linear camera pan to the right, steady uniform clockwise motion throughout, no acceleration or deceleration. Foley and ambient sound effects only, no music, no soundtrack.';
const ORBIT_VIDEO_DURATION = 2.5; // seconds per transition clip
const ORBIT_VIDEO_MODEL = 'ltx23' as const;

/** Appended to all orbit transition prompts to enforce consistent clockwise pan direction */
const ORBIT_DIRECTION_SUFFIX = 'The camera pans smoothly and continuously to the right in a clockwise orbit.';

/** Labels for diagnostic logging — must stay in sync with TRANSITION_COUNT */
const TRANSITION_LABELS = [
  'front→right', 'right→back', 'back→left', 'left→front',
] as const;

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const elevation = (args.elevation as string) || DEFAULT_ELEVATION;
  const distance = (args.distance as string) || DEFAULT_DISTANCE;
  // Suppress per-clip music generation — each clip gets independent audio from
  // LTX 2.3, which creates discontinuous music when stitched. Speech/narration
  // is fine since it's sequential, but music needs to be generated separately.
  const rawPrompt = (args.prompt as string) || DEFAULT_PROMPT;
  const withMusic = /no music|no soundtrack/i.test(rawPrompt)
    ? rawPrompt
    : `${rawPrompt} Foley and ambient sound effects only, no music, no soundtrack.`;
  // Ensure every transition prompt includes directional language so all clips
  // pan in the same direction (clockwise). Without this, the video model may
  // generate some transitions going left and others going right.
  const basePrompt = /to the right|clockwise/i.test(withMusic)
    ? withMusic
    : `${withMusic} ${ORBIT_DIRECTION_SUFFIX}`;

  // Per-segment dialogue: only inject into the specified segment, all others
  // get the base motion/foley prompt. This prevents dialogue from being
  // duplicated across every segment when the user only wants it in one.
  const dialogue = args.dialogue as string | undefined;
  const dialogueSegment = typeof args.dialogueSegment === 'number' ? args.dialogueSegment : 0;

  const buildSegmentPrompt = (segmentIndex: number): string => {
    if (dialogue && segmentIndex === dialogueSegment) {
      return `${dialogue}. ${basePrompt}`;
    }
    return basePrompt;
  };
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

  const totalAngleCost = angleCost * GENERATED_AZIMUTHS.length;
  const totalVideoCost = videoCost * TRANSITION_COUNT;
  const estimatedCost = totalAngleCost + totalVideoCost;

  if (estimatedCost > 0) {
    const preflight = preflightCreditCheck(context, estimatedCost);
    if (!preflight.ok) return preflight.errorJson;
  }

  // Resolve source image URL before emitting 'started' so the UI has a stable placeholder
  const sourceImageUrl = (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) || undefined;

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'orbit_video',
    totalCount: 1,
    estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
    sourceImageUrl,
    stepLabel: 'Preparing orbit',
  });

  // ---------------------------------------------------------------------------
  // Build pipeline
  // ---------------------------------------------------------------------------

  const pipelineConfig: PipelineConfig = {
    parentToolName: 'orbit_video',
    initialState: {
      imageUrls: [],
      videoUrls: [],
      data: {
        sourceImageUrl,
        sourceWidth,
        sourceHeight,
        angleResultIndices: [] as number[],
      },
    },
    steps: [
      // Step 1: Generate 3 angle views (original image is the front view)
      {
        label: 'Generating angle views',
        toolName: 'change_angle',
        count: GENERATED_AZIMUTHS.length,
        concurrent: true,
        buildArgs: (_state, index) => ({
          description: `${GENERATED_AZIMUTHS[index]} ${elevation} ${distance}`,
          sourceImageIndex: effectiveSourceIndex ?? -1,
        }),
        collectResults: (state, results) => {
          // results[i] corresponds to GENERATED_AZIMUTHS[i] via pre-allocated slots
          const angleImageUrls = results
            .flatMap(r => r.imageUrls)
            .filter(Boolean);

          // Hard-fail if any angle is missing — a partial orbit produces visible
          // jump cuts that are worse than no result at all.
          if (angleImageUrls.length !== GENERATED_AZIMUTHS.length) {
            throw new Error(
              `Orbit requires ${GENERATED_AZIMUTHS.length} angle views but only ${angleImageUrls.length} were generated. ` +
              `Cannot produce a seamless 360° orbit video with missing angles.`,
            );
          }
          console.log(`[ORBIT] Collected ${angleImageUrls.length} angle images (slot-ordered: right, back, left)`);

          // Verify each angle URL is present in context.resultUrls (the pipeline's
          // onToolComplete should have pushed them, but race conditions or dedup
          // guards can cause misses). Push any missing URLs and log a warning.
          for (let i = 0; i < angleImageUrls.length; i++) {
            if (!context.resultUrls.includes(angleImageUrls[i])) {
              console.warn(`[ORBIT] Angle image "${GENERATED_AZIMUTHS[i]}" URL missing from context.resultUrls — pushing manually`);
              context.resultUrls.push(angleImageUrls[i]);
            }
          }

          // Pre-compute context.resultUrls indices for each angle image.
          // Full angle sequence for transitions: [source/front, right, back, left]
          // Index 0 = source image (effectiveSourceIndex or -1 for original upload)
          // Indices 1..3 = generated angle images in GENERATED_AZIMUTHS order
          const sourceIdx = effectiveSourceIndex ?? -1;
          const angleResultIndices = [
            sourceIdx,
            ...angleImageUrls.map((url, i) => {
              const idx = context.resultUrls.indexOf(url);
              if (idx === -1) {
                // Should never happen after the push above, but guard defensively
                console.error(`[ORBIT] BUG: Angle image "${GENERATED_AZIMUTHS[i]}" not found in context.resultUrls after manual push`);
              }
              return idx;
            }),
          ];
          console.log(`[ORBIT] Pre-computed angleResultIndices: [${angleResultIndices.join(', ')}] (source, right, back, left)`);

          return {
            ...state,
            imageUrls: angleImageUrls,
            data: { ...state.data, angleImageUrls, angleResultIndices },
          };
        },
      },

      // Step 2: Generate 4 transition clips (front→right, right→back, back→left, left→front)
      // Ordering guarantee: same pre-allocated slot pattern as Step 1. Each
      // slotResults[i] holds the video for transition i, so collectResults
      // produces clips in the correct stitch order regardless of which job
      // finishes first.
      {
        label: 'Generating transitions',
        toolName: 'animate_photo',
        count: TRANSITION_COUNT,
        concurrent: true,
        buildArgs: (state, index) => {
          // angleResultIndices is a 4-element array: [source, right, back, left]
          // representing pre-computed context.resultUrls indices for each angle.
          // Transition i connects angleResultIndices[i] → angleResultIndices[(i+1) % 4].
          const angleResultIndices = state.data.angleResultIndices as number[];

          const startIdx = angleResultIndices[index];
          const endIdx = angleResultIndices[(index + 1) % TRANSITION_COUNT];

          // Validate: -1 is only legitimate for the source/front image (index 0
          // in the sequence) when the user's original upload is the source.
          // For generated angles (indices 1-3), -1 means the URL was lost.
          if (startIdx === -1 && index !== 0) {
            console.error(`[ORBIT] BUG: Pre-computed startIdx is -1 for transition ${index} (${TRANSITION_LABELS[index]}) — angle image URL was not resolved`);
          }
          if (endIdx === -1 && index !== TRANSITION_COUNT - 1) {
            console.error(`[ORBIT] BUG: Pre-computed endIdx is -1 for transition ${index} (${TRANSITION_LABELS[index]}) — angle image URL was not resolved`);
          }
          const segmentPrompt = buildSegmentPrompt(index);
          console.log(`[ORBIT] Transition ${index} (${TRANSITION_LABELS[index]}): sourceImageIndex=${startIdx}, endImageIndex=${endIdx}${dialogue && index === dialogueSegment ? ` [+dialogue]` : ''}`);

          return {
            prompt: segmentPrompt,
            videoModel: ORBIT_VIDEO_MODEL,
            duration: ORBIT_VIDEO_DURATION,
            sourceImageIndex: startIdx,
            endImageIndex: endIdx,
            frameRole: 'both',
            numberOfVariations: 1,
            // Skip animate_photo's vision description, creative refinement, and
            // "A cinematic scene of" prefix. Orbit prompts have precise directional
            // language that must not be buried or rewritten, and both keyframes
            // give the model sufficient visual context.
            skipPromptProcessing: true,
          };
        },
        collectResults: (state, results) => {
          // results[i] corresponds to transition i via pre-allocated slots
          const transitionVideoUrls = results
            .flatMap(r => r.videoUrls)
            .filter(Boolean);
          if (transitionVideoUrls.length !== TRANSITION_COUNT) {
            console.warn(`[ORBIT] Expected ${TRANSITION_COUNT} transition videos but got ${transitionVideoUrls.length} — stitch order may be wrong`);
          }
          console.log(`[ORBIT] Collected ${transitionVideoUrls.length} transition videos (slot-ordered: front→right, right→back, back→left, left→front)`);
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

          // Save to gallery synchronously so the gallery ID is available for
          // onGallerySaved after onToolComplete (ensures correct index alignment).
          let galleryVideoId: string | undefined;
          try {
            const { galleryImageId } = await saveVideoToGallery({ videoBlob: blob });
            galleryVideoId = galleryImageId;
          } catch (err) {
            console.error('[ORBIT] Failed to save orbit video to gallery:', err);
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
        error: 'orbit_failed',
        message: 'Pipeline completed but no final video was produced.',
      });
    }

    // Only emit the final stitched video — individual transition clips are
    // intermediate artifacts and would be confusing in the result grid.
    callbacks.onToolComplete('orbit_video', finalState.imageUrls, [finalVideoUrl]);

    // Apply gallery ID after onToolComplete so the message has videoResults
    // when applyGalleryIdsToMessages scans for the target message.
    const stitchedGalleryId = finalState.data.stitchedGalleryId as string | undefined;
    if (stitchedGalleryId) {
      callbacks.onGallerySaved?.([], [stitchedGalleryId]);
    }

    return JSON.stringify({
      success: true,
      resultCount: 1,
      mediaType: 'video',
      creditsCost: estimatedCost > 0 ? formatCredits(estimatedCost) : undefined,
      message: `Successfully created a 360-degree orbit video with ${TRANSITION_COUNT} transitions.${estimatedCost > 0 ? ` Estimated cost: ~${formatCredits(estimatedCost)} credits.` : ''} The user can now see and play the orbit video.`,
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
