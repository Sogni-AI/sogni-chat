/**
 * Handler for sound_to_video tool.
 * Based on workflow_sound_to_video.mjs — audio-driven video generation.
 */

import type { ToolExecutionContext, ToolCallbacks, UploadedFile } from '../types';
import {
  preflightCreditCheck,
  tryWithTokenFallback,
  isInsufficientCreditsError,
  registerPendingCost,
  recordCompletion,
  discardPending,
  formatCredits,
  fetchAudioAsUint8Array,
} from '../shared';
import type { TokenType } from '@/types/wallet';
import { parseAspectRatio } from '@/utils/imageDimensions';
import { fetchVideoCostEstimate } from '@/services/creditsService';

// ---------------------------------------------------------------------------
// S2V model configurations (from MODELS.s2v in workflow-helpers.mjs)
// ---------------------------------------------------------------------------

interface S2VModelConfig {
  id: string;
  name: string;
  defaultWidth: number;
  defaultHeight: number;
  dimensionStep: number;
  minDimension: number;
  maxDimension: number;
  defaultSteps: number;
  defaultGuidance: number;
  defaultFps: number;
  frameStep: number;
  minFrames: number;
  maxFrames: number;
  sampler: string;
  scheduler: string;
  shift?: number;
  requiresReferenceImage: boolean;
}

const S2V_MODELS: Record<string, S2VModelConfig> = {
  'wan-s2v': {
    id: 'wan_v2.2-14b-fp8_s2v_lightx2v',
    name: 'WAN 2.2 S2V LightX2V',
    defaultWidth: 832,
    defaultHeight: 480,
    dimensionStep: 16,
    minDimension: 480,
    maxDimension: 1536,
    defaultSteps: 4,
    defaultGuidance: 1.0,
    defaultFps: 16,
    frameStep: 1,
    minFrames: 17,
    maxFrames: 321,
    sampler: 'uni_pc',
    scheduler: 'simple',
    shift: 8.0,
    requiresReferenceImage: true,
  },
  'ltx23-ia2v': {
    id: 'ltx23-22b-fp8_ia2v_distilled',
    name: 'LTX 2.3 Image+Audio to Video',
    defaultWidth: 1920,
    defaultHeight: 1088,
    dimensionStep: 64,
    minDimension: 640,
    maxDimension: 3840,
    defaultSteps: 8,
    defaultGuidance: 1.0,
    defaultFps: 24,
    frameStep: 8,
    minFrames: 25,
    maxFrames: 505,
    sampler: 'euler_ancestral',
    scheduler: 'simple',
    requiresReferenceImage: true,
  },
  'ltx23-a2v': {
    id: 'ltx23-22b-fp8_a2v_distilled',
    name: 'LTX 2.3 Audio to Video',
    defaultWidth: 1920,
    defaultHeight: 1088,
    dimensionStep: 64,
    minDimension: 640,
    maxDimension: 3840,
    defaultSteps: 8,
    defaultGuidance: 1.0,
    defaultFps: 24,
    frameStep: 8,
    minFrames: 25,
    maxFrames: 505,
    sampler: 'euler_ancestral',
    scheduler: 'simple',
    requiresReferenceImage: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFrames(duration: number, config: S2VModelConfig): number {
  const isWan = config.id.startsWith('wan_');
  const internalFps = isWan ? 16 : config.defaultFps;
  let frames = Math.round(duration * internalFps) + 1;

  if (!isWan && config.frameStep > 1) {
    const n = Math.round((frames - 1) / config.frameStep);
    frames = n * config.frameStep + 1;
  }

  return Math.max(config.minFrames, Math.min(config.maxFrames, frames));
}

function computeDimensions(
  requestedW: number | undefined,
  requestedH: number | undefined,
  aspectRatio: string | undefined,
  config: S2VModelConfig,
  imageWidth?: number,
  imageHeight?: number,
  targetResolution?: number,
): { width: number; height: number } {
  let w = requestedW ?? imageWidth ?? config.defaultWidth;
  let h = requestedH ?? imageHeight ?? config.defaultHeight;

  const parsed = parseAspectRatio(aspectRatio);
  if (parsed?.type === 'exact') {
    w = parsed.width;
    h = parsed.height;
  } else if (parsed?.type === 'ratio') {
    const area = w * h;
    const ratio = parsed.ratioW / parsed.ratioH;
    w = Math.sqrt(area * ratio);
    h = area / w;
  }

  // Apply target resolution: scale shorter side to the target value
  if (targetResolution !== undefined) {
    const roundedTarget = Math.round(targetResolution / config.dimensionStep) * config.dimensionStep;
    if (w <= h) {
      h = Math.round((h * roundedTarget / w) / config.dimensionStep) * config.dimensionStep;
      w = roundedTarget;
    } else {
      w = Math.round((w * roundedTarget / h) / config.dimensionStep) * config.dimensionStep;
      h = roundedTarget;
    }
  }

  const step = config.dimensionStep;
  w = Math.round(w / step) * step;
  h = Math.round(h / step) * step;
  w = Math.max(config.minDimension, Math.min(config.maxDimension, w));
  h = Math.max(config.minDimension, Math.min(config.maxDimension, h));

  return { width: w, height: h };
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
  const explicitModel = args.videoModel as string | undefined;
  const duration = Math.max(2, Math.min(20, (args.duration as number) || 5));
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const aspectRatio = args.aspectRatio as string | undefined;
  const audioSourceIndex = args.audioSourceIndex as number | undefined;
  const sourceImageIndex = args.sourceImageIndex as number | undefined;

  // Determine if any image is available (uploaded or in context)
  const hasUploadedImage = context.uploadedFiles.some((f: UploadedFile) => f.type === 'image') || !!context.imageData;

  // Auto-select model: if no model was explicitly chosen and no image is available,
  // use ltx23-a2v (audio-only to video) instead of the default wan-s2v which requires an image.
  let modelKey = explicitModel || 'wan-s2v';
  if (!explicitModel && !hasUploadedImage) {
    modelKey = 'ltx23-a2v';
    console.log('[SOUND TO VIDEO] No image available, auto-selecting ltx23-a2v (audio-only to video)');
  }

  const config = S2V_MODELS[modelKey] ?? S2V_MODELS['wan-s2v'];

  // Locate the audio: first check uploaded files, then fall back to generated audio in resultUrls
  let audioData: Uint8Array;
  let audioMimeType: string;

  const audioFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'audio');
  const audioIndex = audioSourceIndex ?? 0;
  const audioFile = audioFiles[audioIndex];

  if (audioFile && audioFile.data && audioFile.data.byteLength > 0) {
    // Use uploaded audio file
    audioData = audioFile.data;
    audioMimeType = audioFile.mimeType;
  } else {
    // Fallback: look for generated audio tracked by the session (e.g. from generate_music)
    const audioResultUrls = context.audioResultUrls;
    if (audioResultUrls.length === 0) {
      return JSON.stringify({ error: 'no_audio', message: 'No audio available. Either upload an audio file (mp3, wav, m4a) or use generate_music first to create audio. Do not call any other tools.' });
    }
    // Use the most recent generated audio
    const targetAudioUrl = audioResultUrls[audioResultUrls.length - 1];
    console.log('[SOUND TO VIDEO] No uploaded audio found, fetching generated audio from:', targetAudioUrl);
    try {
      const fetched = await fetchAudioAsUint8Array(targetAudioUrl);
      audioData = fetched.data;
      audioMimeType = fetched.mimeType;
    } catch (err) {
      console.error('[SOUND TO VIDEO] Failed to fetch generated audio:', err);
      return JSON.stringify({ error: 'audio_fetch_failed', message: 'Could not load the generated audio. Try uploading the audio file directly.' });
    }
  }

  // Locate the reference image (if required or specified)
  let referenceImageData: Uint8Array | null = null;
  let referenceImageMime = 'image/jpeg';
  let imgWidth = config.defaultWidth;
  let imgHeight = config.defaultHeight;

  if (config.requiresReferenceImage || sourceImageIndex !== undefined) {
    if (sourceImageIndex !== undefined && sourceImageIndex >= 0) {
      const imageFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'image');
      const imgFile = imageFiles[sourceImageIndex];
      if (imgFile) {
        referenceImageData = imgFile.data;
        referenceImageMime = imgFile.mimeType;
        imgWidth = imgFile.width ?? config.defaultWidth;
        imgHeight = imgFile.height ?? config.defaultHeight;
      }
    }

    if (!referenceImageData && context.imageData) {
      referenceImageData = context.imageData;
      referenceImageMime = context.uploadedFiles.find(f => f.type === 'image')?.mimeType ?? 'image/jpeg';
      imgWidth = context.width;
      imgHeight = context.height;
    }

    if (!referenceImageData && config.requiresReferenceImage) {
      return JSON.stringify({ error: 'no_image', message: 'This model requires a reference image. Please upload a face/subject image.' });
    }
  }

  // Quality-based resolution: Standard (fast) -> 720p (768), High (hq) -> 1080p (1088)
  const isLTX = modelKey.startsWith('ltx');
  const qualityTier = context.qualityTier || 'fast';
  const targetResolution = isLTX
    ? (qualityTier === 'hq' ? 1088 : 768)
    : undefined;

  const { width, height } = computeDimensions(
    args.width as number | undefined,
    args.height as number | undefined,
    aspectRatio,
    config,
    imgWidth,
    imgHeight,
    targetResolution,
  );
  const frames = computeFrames(duration, config);
  const fps = config.defaultFps;
  const steps = config.defaultSteps;
  const videoAspectRatio = `${width} / ${height}`;
  const mediaLabel = `${config.name} — ${duration}s @ ${width}x${height}`;

  // Cost estimation & pre-flight
  const originalToken = context.tokenType;
  const singleCost = await fetchVideoCostEstimate(context.tokenType, config.id, width, height, frames, fps, steps);
  let estimatedCost = singleCost * numberOfMedia;

  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    const retrySingleCost = await fetchVideoCostEstimate(context.tokenType, config.id, width, height, frames, fps, steps);
    estimatedCost = retrySingleCost * numberOfMedia;
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'sound_to_video',
    totalCount: numberOfMedia,
    estimatedCost,
    videoAspectRatio,
    modelName: mediaLabel,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('sound_to_video', estimatedCost, context.tokenType)
    : null;

  try {
    const videoUrls = await tryWithTokenFallback(
      (tokenType: TokenType) => runS2VGeneration(
        context.sogniClient,
        {
          modelId: config.id,
          prompt,
          referenceImage: referenceImageData,
          referenceImageMime,
          referenceAudio: audioData,
          referenceAudioMime: audioMimeType,
          width,
          height,
          frames,
          fps,
          steps,
          guidance: config.defaultGuidance,
          shift: config.shift,
          numberOfMedia,
          tokenType,
          sampler: config.sampler,
          scheduler: config.scheduler,
          disableNSFWFilter: context.safeContentFilter === false,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.completed ? 'completed' : 'progress',
            toolName: 'sound_to_video',
            progress: progress.progress,
            completedCount: progress.completedCount,
            totalCount: numberOfMedia,
            jobIndex: progress.jobIndex,
            etaSeconds: progress.etaSeconds,
            videoResultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
            estimatedCost,
            videoAspectRatio,
          });
        },
        context.signal,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);
    callbacks.onToolComplete('sound_to_video', [], videoUrls);

    return JSON.stringify({
      success: true,
      resultCount: videoUrls.length,
      mediaType: 'video',
      model: config.name,
      duration,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${videoUrls.length} audio-synchronized ${duration}-second video${videoUrls.length !== 1 ? 's' : ''} using ${config.name}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see and play the video${videoUrls.length !== 1 ? 's' : ''}.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for sound-to-video generation.' });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SDK project execution
// ---------------------------------------------------------------------------

interface S2VParams {
  modelId: string;
  prompt: string;
  referenceImage: Uint8Array | null;
  referenceImageMime: string;
  referenceAudio: Uint8Array;
  referenceAudioMime: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  steps: number;
  guidance: number;
  shift?: number;
  numberOfMedia: number;
  tokenType: TokenType;
  sampler: string;
  scheduler: string;
  disableNSFWFilter?: boolean;
}

interface S2VProgress {
  progress?: number;
  completedCount?: number;
  jobIndex?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runS2VGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: S2VParams,
  onProgress: (progress: S2VProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const projectParams: Record<string, unknown> = {
    type: 'video',
    modelId: params.modelId,
    positivePrompt: params.prompt,
    numberOfMedia: params.numberOfMedia,
    width: params.width,
    height: params.height,
    frames: params.frames,
    fps: params.fps,
    steps: params.steps,
    seed: -1,
    referenceAudio: new Blob([params.referenceAudio as BlobPart], { type: params.referenceAudioMime || 'audio/mpeg' }),
    sampler: params.sampler,
    scheduler: params.scheduler,
    tokenType: params.tokenType,
    disableNSFWFilter: !!params.disableNSFWFilter,
  };

  if (params.referenceImage) {
    projectParams.referenceImage = new Blob([params.referenceImage as BlobPart], { type: params.referenceImageMime || 'image/jpeg' });
  }
  if (params.guidance !== undefined) {
    projectParams.guidance = params.guidance;
  }
  if (params.shift !== undefined) {
    projectParams.shift = params.shift;
  }

  const projects = (sogniClient as unknown as { projects: {
    create: (p: Record<string, unknown>) => Promise<{ id: string }>;
    on: (e: string, h: (ev: Record<string, unknown>) => void) => void;
    off: (e: string, h: (ev: Record<string, unknown>) => void) => void;
  } }).projects;

  const project = await projects.create(projectParams);

  return new Promise<string[]>((resolve, reject) => {
    const resultUrls: string[] = [];
    let completedCount = 0;
    let failedCount = 0;
    const totalJobs = params.numberOfMedia;

    // Check if already aborted before setting up listeners
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    // Safety timeout: 3 minutes
    const safetyTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Sound-to-video generation timed out. The audio file may be invalid or the service is unavailable.'));
    }, 180_000);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Sound-to-video generation aborted'));
    };

    const cleanup = () => {
      clearTimeout(safetyTimeout);
      signal?.removeEventListener('abort', abortHandler);
      projects.off('job', jobHandler);
      projects.off('project', projectHandler);
    };

    const checkDone = () => {
      if (completedCount + failedCount >= totalJobs) {
        cleanup();
        if (failedCount === totalJobs) {
          reject(new Error(`All ${totalJobs} sound-to-video jobs failed`));
        } else {
          resolve(resultUrls.filter(Boolean));
        }
      }
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Map jobId → jobIndex from initiating/started events (which include jobIndex)
    const jobIdToIndex = new Map<string, number>();

    const jobHandler = (event: Record<string, unknown>) => {
      if ((event as { projectId?: string }).projectId !== project.id) return;

      switch (event.type) {
        case 'initiating':
        case 'started': {
          if (event.jobId && event.jobIndex !== undefined) {
            jobIdToIndex.set(event.jobId as string, event.jobIndex as number);
          }
          break;
        }
        case 'progress': {
          const step = event.step as number | undefined;
          const stepCount = event.stepCount as number | undefined;
          if (step !== undefined && stepCount !== undefined && stepCount > 0) {
            onProgress({ progress: step / stepCount, jobIndex: event.jobId ? jobIdToIndex.get(event.jobId as string) : undefined });
          }
          break;
        }
        case 'jobETA': {
          onProgress({ etaSeconds: event.etaSeconds as number | undefined, jobIndex: event.jobId ? jobIdToIndex.get(event.jobId as string) : undefined });
          break;
        }
        case 'completed': {
          if (!event.jobId) return;
          const resultUrl = event.resultUrl as string | undefined;
          if (resultUrl && !event.error) {
            resultUrls.push(resultUrl);
            completedCount++;
            onProgress({ completed: completedCount >= totalJobs, completedCount, jobIndex: jobIdToIndex.get(event.jobId as string), resultUrl, progress: 1 });
          } else {
            failedCount++;
            console.error('[SOUND TO VIDEO] Job completed with error:', event.error);
          }
          checkDone();
          break;
        }
        case 'error':
        case 'failed': {
          failedCount++;
          console.error('[SOUND TO VIDEO] Job failed:', event.error);
          checkDone();
          break;
        }
      }
    };

    const projectHandler = (event: Record<string, unknown>) => {
      if ((event as { projectId?: string }).projectId !== project.id) return;
      if (event.type === 'error' || event.type === 'failed') {
        cleanup();
        reject(new Error(String((event.error as { message?: string })?.message || event.error || 'Project failed')));
      }
    };

    projects.on('job', jobHandler);
    projects.on('project', projectHandler);
  });
}
