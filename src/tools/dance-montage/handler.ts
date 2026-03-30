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

/** Max duration for a single V2V clip (WAN 2.2 Animate Move supports up to 20s) */
const MAX_CLIP_DURATION = 20;

/** Fixed 9:16 480p output — matches dance reference video format.
 *  480 / 16 = 30 (exact), 480 * 16/9 = 853.3 → round to 848 (53 * 16). */
const DANCE_WIDTH = 480;
const DANCE_HEIGHT = 848;

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
  const imagePrompt = args.imagePrompt as string | undefined;

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
  const hasPersonaPhotos = imageFiles.some(f => f.filename?.startsWith('persona-'));
  const resolvedImages: ResolvedImage[] = [];

  // When persona photos are present, check for generated results FIRST.
  // Generated results (e.g. bobbleheads from edit_image) should take priority
  // over raw persona reference photos. But if no generated results exist,
  // persona photos are still valid source images for direct use.
  if (hasPersonaPhotos && rawSourceIndex === undefined && context.resultUrls.length > 0) {
    console.log(`[DANCE MONTAGE] Personas detected — preferring ${context.resultUrls.length} generated result(s) over raw persona photos`);
    const fetchResults = await Promise.allSettled(
      context.resultUrls.map((url, i) =>
        fetchImageAsUint8Array(url).then(fetched => ({
          index: i,
          data: fetched.data,
          width: fetched.width,
          height: fetched.height,
          mimeType: fetched.mimeType,
        })),
      ),
    );
    for (const result of fetchResults) {
      if (result.status === 'fulfilled') {
        resolvedImages.push({
          data: result.value.data,
          width: result.value.width,
          height: result.value.height,
          mimeType: result.value.mimeType,
        });
      } else {
        console.warn('[DANCE MONTAGE] Skipping unfetchable result image:', result.reason);
      }
    }
    if (resolvedImages.length > 0) {
      console.log(`[DANCE MONTAGE] Using ${resolvedImages.length} generated result image(s) for montage`);
    }
    // If all fetches failed, fall through to remaining resolution paths
  }

  if (resolvedImages.length > 0) {
    // Already resolved above (persona + generated results path)
  } else if (imageFiles.length > 1 && !(hasPersonaPhotos && imagePrompt)) {
    // Multi-image upload: use ALL uploaded image files (including persona photos
    // if that's all that's available — the user may want raw photos for dancing).
    // Skip this path when imagePrompt is provided with personas — that signals the
    // LLM wants auto-generated styled images, not raw reference photos.
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
  } else if (rawSourceIndex === undefined && context.resultUrls.length > 0) {
    // No explicit sourceImageIndex — use ALL previously generated images.
    // This is the common path when generate_image produced multiple images
    // (e.g. 4 bobblehead variants) and the LLM then calls dance_montage
    // without specifying which image to use.
    console.log(`[DANCE MONTAGE] Fetching ${context.resultUrls.length} previously generated result(s) for montage`);
    const fetchResults = await Promise.allSettled(
      context.resultUrls.map((url, i) =>
        fetchImageAsUint8Array(url).then(fetched => ({
          index: i,
          data: fetched.data,
          width: fetched.width,
          height: fetched.height,
          mimeType: fetched.mimeType,
        })),
      ),
    );
    for (const result of fetchResults) {
      if (result.status === 'fulfilled') {
        resolvedImages.push({
          data: result.value.data,
          width: result.value.width,
          height: result.value.height,
          mimeType: result.value.mimeType,
        });
      } else {
        console.warn('[DANCE MONTAGE] Skipping unfetchable result image:', result.reason);
      }
    }
    if (resolvedImages.length > 0) {
      console.log(`[DANCE MONTAGE] Using ${resolvedImages.length} generated result image(s) for montage`);
    }
    // If all fetches failed, fall through to uploaded image fallbacks below
  }

  // Fallbacks: if no images resolved yet, try uploaded files or primary image data
  if (resolvedImages.length === 0 && imageFiles.length === 1) {
    // Single uploaded image
    resolvedImages.push({
      data: imageFiles[0].data,
      width: imageFiles[0].width || context.width || 512,
      height: imageFiles[0].height || context.height || 512,
      mimeType: imageFiles[0].mimeType,
    });
    console.log('[DANCE MONTAGE] Using single uploaded image');
  } else if (resolvedImages.length === 0 && context.imageData) {
    // Fallback to primary uploaded image data
    resolvedImages.push({
      data: context.imageData,
      width: context.width || 512,
      height: context.height || 512,
      mimeType: imageFiles[0]?.mimeType ?? 'image/jpeg',
    });
    console.log('[DANCE MONTAGE] Using primary image data');
  }

  // ---------------------------------------------------------------------------
  // Auto-generate per-persona images when personas are loaded but no images
  // resolved. Each persona gets its own scoped context (only that persona's
  // reference photo) so the generation model produces exactly ONE person per
  // image — fixing the issue where all persona photos in context cause every
  // generated image to contain all people.
  // ---------------------------------------------------------------------------
  const personaPhotos = context.uploadedFiles.filter(
    (f: UploadedFile) => f.type === 'image' && f.filename?.startsWith('persona-'),
  );

  if (resolvedImages.length === 0 && personaPhotos.length > 0) {
    const stylePrompt = imagePrompt || 'full-body portrait in a fun, dynamic pose, perfect for dancing';
    const imagesPerPersona = Math.max(1, Math.ceil(4 / personaPhotos.length));
    const totalImages = imagesPerPersona * personaPhotos.length;

    console.log(
      `[DANCE MONTAGE] Auto-generating ${totalImages} persona images ` +
      `(${imagesPerPersona} per persona × ${personaPhotos.length} personas)`,
    );

    callbacks.onToolProgress({
      type: 'started',
      toolName: 'dance_montage',
      totalCount: 1,
      stepLabel: 'Generating persona images',
    });

    for (let p = 0; p < personaPhotos.length; p++) {
      if (context.signal?.aborted) break;
      const photo = personaPhotos[p];
      const personaName = photo.filename
        ?.replace(/^persona-/, '')
        .replace(/\.jpg$/, '')
        .replace(/-/g, ' ') || 'person';

      // Scoped context: ONLY this persona's reference photo.
      // Object.create preserves access to shared getters (sogniClient, tokenType,
      // etc.) while letting us override uploadedFiles and imageData.
      const scopedContext = Object.create(context) as ToolExecutionContext;
      scopedContext.uploadedFiles = [photo];
      scopedContext.imageData = photo.data;
      scopedContext.width = photo.width || 512;
      scopedContext.height = photo.height || 512;

      const prompt = `Use the face from picture 1 for ${personaName}. ${stylePrompt}`;
      console.log(`[DANCE MONTAGE] Generating ${imagesPerPersona} image(s) for persona "${personaName}"`);

      const generatedUrls: string[] = [];
      const editCallbacks: ToolCallbacks = {
        onToolProgress: (progress) => {
          if (progress.type === 'started') return;
          callbacks.onToolProgress({
            ...progress,
            toolName: 'dance_montage',
            stepLabel: `Generating ${personaName} image`,
          });
        },
        onToolComplete: (_toolName, resultUrls) => {
          if (resultUrls) generatedUrls.push(...resultUrls);
        },
        onInsufficientCredits: callbacks.onInsufficientCredits,
      };

      try {
        const rawResult = await toolRegistry.execute(
          'edit_image',
          {
            prompt,
            numberOfVariations: imagesPerPersona,
            aspectRatio: '9:16',
          },
          scopedContext,
          editCallbacks,
        );

        // Check for errors from edit_image
        try {
          const parsed = JSON.parse(rawResult);
          if (parsed.error) {
            console.error(`[DANCE MONTAGE] edit_image failed for "${personaName}":`, parsed.message);
            continue;
          }
        } catch { /* not JSON — treat as success */ }

        // Fetch the generated images as binary data
        for (const url of generatedUrls) {
          try {
            const fetched = await fetchImageAsUint8Array(url);
            resolvedImages.push({
              data: fetched.data,
              width: fetched.width,
              height: fetched.height,
              mimeType: fetched.mimeType,
            });
          } catch (err) {
            console.warn('[DANCE MONTAGE] Failed to fetch generated persona image:', err);
          }
        }
      } catch (err) {
        console.error(`[DANCE MONTAGE] Failed to generate persona image for "${personaName}":`, err);
      }
    }

    if (resolvedImages.length > 0) {
      // Interleave images so personas alternate: [A1, B1, A2, B2, ...]
      if (personaPhotos.length > 1) {
        const perPersona: ResolvedImage[][] = Array.from({ length: personaPhotos.length }, () => []);
        let personaIdx = 0;
        for (const img of resolvedImages) {
          perPersona[personaIdx].push(img);
          if (perPersona[personaIdx].length >= imagesPerPersona) personaIdx++;
        }
        const interleaved: ResolvedImage[] = [];
        const maxLen = Math.max(...perPersona.map(a => a.length));
        for (let i = 0; i < maxLen; i++) {
          for (const group of perPersona) {
            if (group[i]) interleaved.push(group[i]);
          }
        }
        resolvedImages.length = 0;
        resolvedImages.push(...interleaved);
      }
      console.log(`[DANCE MONTAGE] Generated ${resolvedImages.length} persona images (interleaved)`);
    }
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

  // Frame count for cost estimation only — V2V computes its own frames internally
  const framesPerClip = Math.max(17, Math.min(321, Math.round(segmentDuration * V2V_INTERNAL_FPS) + 1));

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

  const width = DANCE_WIDTH;
  const height = DANCE_HEIGHT;
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
    totalCount: segmentCount,
    estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
    stepLabel: `Preparing ${preset.title} dance`,
    videoAspectRatio,
    modelName: `WAN 2.2 Animate — ${duration}s (${segmentCount} clips)`,
  });

  // ---------------------------------------------------------------------------
  // Phase 2: Generate clips via pipeline
  // ---------------------------------------------------------------------------

  const danceVideoFile: UploadedFile = {
    type: 'video',
    data: danceVideoData,
    mimeType: danceVideoMime,
    filename: `${preset.id}-reference.mp4`,
  };

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
            videoAspectRatio,
            modelName: `WAN 2.2 Animate — ${segmentDuration}s/clip`,
          });

          for (let j = 0; j < segmentCount; j++) {
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'dance_montage',
              stepLabel: 'Generating dance clips',
              jobLabel: `Clip ${j + 1} of ${segmentCount}`,
              jobIndex: j,
              totalCount: segmentCount,
              completedCount: 0,
              videoAspectRatio,
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
                // Extract video completion URL for per-slot display only —
                // do NOT forward via videoResultUrls (that would contaminate
                // message.videoResults with intermediate clip URLs, causing
                // duplicates and "Video expired" errors).
                const completedVideoUrl = progress.videoResultUrls?.[0];
                stepCallbacks.onToolProgress({
                  ...progress,
                  toolName: 'dance_montage',
                  stepLabel: 'Generating dance clips',
                  jobLabel: `Clip ${i + 1} of ${segmentCount}`,
                  jobIndex: i,
                  totalCount: segmentCount,
                  completedCount,
                  estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
                  videoAspectRatio,
                  videoResultUrls: undefined,
                  sourceImageUrl: undefined,
                  // Inject completed clip URL into perJobProgress for UI display
                  // without leaking into message.videoResults accumulation.
                  ...(completedVideoUrl ? {
                    perJobProgress: {
                      [i]: { resultUrl: completedVideoUrl, isVideo: true, progress: 1 },
                    },
                  } : {}),
                });
              },
              onToolComplete: (_toolName, resultUrls, videoResultUrls) => {
                completedCount++;
                slotResults[i] = {
                  ...slotResults[i],
                  imageUrls: resultUrls || [],
                  videoUrls: videoResultUrls || [],
                };
                // Do NOT push intermediate clip URLs into ctx.videoResultUrls —
                // only the final stitched montage should be in the session-wide
                // video array. Leaking clips would pollute videoStartIndex and
                // cause stitch_video to reference expired intermediate URLs.
              },
              onInsufficientCredits: stepCallbacks.onInsufficientCredits,
              onGallerySaved: undefined,
            };

            return toolRegistry.execute(
              'video_to_video',
              {
                prompt: '',
                negativePrompt: 'talking, lip sync, mouth movement, lip movement, open mouth, speaking',
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

            // Wait for ANY retry button click OR abort signal
            const retryIndex = await Promise.race([
              ...failedIndices.map(i => {
                const key = retryKeys.find(k => k.includes(`-clip-${i}-`))!;
                return onRetry(key).then(() => i);
              }),
              new Promise<never>((_, reject) => {
                if (ctx.signal?.aborted) reject(new Error('Cancelled'));
                else ctx.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
              }),
            ]);

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

          // -----------------------------------------------------------------
          // Review phase: let the user preview clips and redo any before stitching.
          // Single-segment dances skip review — no stitching needed.
          // -----------------------------------------------------------------
          if (segmentCount > 1) {
            console.log(`[DANCE MONTAGE] Entering review phase — ${segmentCount} clips ready`);

            // Single abort promise shared across all review iterations to avoid
            // accumulating orphaned abort listeners on ctx.signal.
            const abortPromise = new Promise<never>((_, reject) => {
              if (ctx.signal?.aborted) reject(new Error('Cancelled'));
              else ctx.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
            });

            let reviewing = true;
            while (reviewing) {
              if (ctx.signal?.aborted) throw new Error('Cancelled');

              const ts = Date.now();
              const confirmKey = `${ctx.sessionId}-dance-confirm-${ts}`;
              const redoKeys = Array.from({ length: segmentCount }, (_, i) =>
                `${ctx.sessionId}-dance-redo-${i}-${ts}`,
              );

              // Build per-job progress showing every completed clip with a redo key
              const reviewPerJob: Record<number, {
                resultUrl?: string;
                isVideo?: boolean;
                progress?: number;
                retryKey?: string;
                label?: string;
              }> = {};
              for (let i = 0; i < segmentCount; i++) {
                reviewPerJob[i] = {
                  resultUrl: slotResults[i].videoUrls[0],
                  isVideo: true,
                  progress: 1,
                  retryKey: redoKeys[i],
                  label: `Clip ${i + 1}`,
                };
              }

              stepCallbacks.onToolProgress({
                type: 'progress',
                toolName: 'dance_montage',
                stepLabel: 'Review clips',
                totalCount: segmentCount,
                completedCount: segmentCount,
                videoAspectRatio,
                confirmKey,
                confirmLabel: 'Stitch Montage',
                confirmDescription: 'Tap any clip to preview. Redo clips you want to change.',
                perJobProgress: reviewPerJob,
              });

              // Wait for either confirm (stitch) or redo (regenerate a clip)
              const action = await Promise.race([
                onRetry(confirmKey).then(() => ({ type: 'confirm' as const, index: -1 })),
                ...redoKeys.map((key, i) =>
                  onRetry(key).then(() => ({ type: 'redo' as const, index: i })),
                ),
                abortPromise,
              ]);

              // Clean up all pending listeners
              cancelRetry(confirmKey);
              for (const key of redoKeys) cancelRetry(key);

              if (action.type === 'confirm') {
                console.log('[DANCE MONTAGE] User confirmed — proceeding to stitch');
                reviewing = false;
              } else {
                const redoIdx = action.index;
                console.log(`[DANCE MONTAGE] User requested redo for clip ${redoIdx + 1}`);

                // Clear retryKeys on ALL slots and confirmKey to prevent non-functional
                // buttons while the redo is in progress.
                const redoPerJob: Record<number, {
                  progress?: number;
                  label?: string;
                  retryKey?: string;
                }> = {};
                for (let i = 0; i < segmentCount; i++) {
                  redoPerJob[i] = i === redoIdx
                    ? { progress: 0, label: `Redoing clip ${redoIdx + 1}...`, retryKey: undefined }
                    : { retryKey: undefined };
                }

                stepCallbacks.onToolProgress({
                  type: 'progress',
                  toolName: 'dance_montage',
                  stepLabel: 'Regenerating clip',
                  totalCount: segmentCount,
                  completedCount: segmentCount - 1,
                  videoAspectRatio,
                  confirmKey: undefined,
                  confirmLabel: undefined,
                  perJobProgress: redoPerJob,
                });

                // Regenerate the single clip
                const redoResult = await Promise.allSettled([generateClip(redoIdx)]);
                if (redoResult[0].status === 'rejected') {
                  console.warn(`[DANCE MONTAGE] Redo of clip ${redoIdx + 1} failed:`, redoResult[0].reason);
                  // Keep the previous clip — loop back to review with it still shown
                }
                completedCount = segmentCount; // all slots filled again
                // Loop back to review state
              }
            }

            // Clear review UI state before proceeding to stitch. The stitch step's
            // progress events don't include confirmKey, so without this explicit clear
            // the "Stitch Montage" button would persist via the progress merge spread.
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'dance_montage',
              stepLabel: 'Preparing to stitch...',
              totalCount: segmentCount,
              completedCount: segmentCount,
              videoAspectRatio,
              confirmKey: undefined,
              confirmLabel: undefined,
            });
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

          console.log(`[DANCE MONTAGE] Stitching ${clipUrls.length} clips with source audio overlay`);
          // Pass the original dance reference video as audio source — its audio
          // track is extracted and muxed over the concatenated result, preventing
          // ugly gaps/stutter from stitching individual clip audio together.
          const audioSource = {
            buffer: danceVideoData.buffer.slice(
              danceVideoData.byteOffset,
              danceVideoData.byteOffset + danceVideoData.byteLength,
            ) as ArrayBuffer,
            startOffset: 0,
          };
          const blob = await concatenateVideos(clipUrls, (progress) => {
            stepCallbacks.onToolProgress({
              type: 'progress',
              toolName: 'dance_montage',
              progress,
              stepLabel: 'Stitching dance montage',
            });
          }, audioSource);

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
