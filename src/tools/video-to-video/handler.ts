/**
 * Handler for video_to_video tool.
 * Based on workflow_video_to_video.mjs — ControlNet video transforms.
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
} from '../shared';
import type { TokenType } from '@/types/wallet';
import { fetchVideoCostEstimate } from '@/services/creditsService';

// ---------------------------------------------------------------------------
// V2V model configurations (from MODELS.v2v in workflow-helpers.mjs)
// ---------------------------------------------------------------------------

interface V2VModelConfig {
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
  requiresImage?: boolean;
}

/** LTX-2 V2V ControlNet — supports canny, pose, depth, detailer */
const LTX2_V2V: V2VModelConfig = {
  id: 'ltx2-19b-fp8_v2v_distilled',
  name: 'LTX-2 V2V ControlNet',
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
  maxFrames: 257,
  sampler: 'euler_ancestral',
  scheduler: 'simple',
};

/** WAN 2.2 Animate — shared config for animate-move and animate-replace */
const WAN_ANIMATE_BASE: Omit<V2VModelConfig, 'id'> = {
  name: 'WAN 2.2 Animate LightX2V',
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
  maxFrames: 161,
  sampler: 'euler',
  scheduler: 'simple',
  requiresImage: true,
};

type ControlMode = 'canny' | 'pose' | 'depth' | 'detailer' | 'animate-move' | 'animate-replace';

function getModelForControlMode(mode: ControlMode): V2VModelConfig {
  if (mode === 'animate-move') {
    return { id: 'wan_v2.2-14b-fp8_animate-move_lightx2v', ...WAN_ANIMATE_BASE };
  }
  if (mode === 'animate-replace') {
    return { id: 'wan_v2.2-14b-fp8_animate-replace_lightx2v', ...WAN_ANIMATE_BASE };
  }
  return LTX2_V2V;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFrames(duration: number, config: V2VModelConfig): number {
  const isWan = config.id.startsWith('wan_');
  const internalFps = isWan ? 16 : config.defaultFps;
  let frames = Math.round(duration * internalFps) + 1;

  if (!isWan && config.frameStep > 1) {
    const n = Math.round((frames - 1) / config.frameStep);
    frames = n * config.frameStep + 1;
  }

  return Math.max(config.minFrames, Math.min(config.maxFrames, frames));
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
  const controlMode: ControlMode = (args.controlMode as ControlMode) || 'canny';
  const duration = Math.max(2, Math.min(10, (args.duration as number) || 5));
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const videoSourceIndex = args.videoSourceIndex as number | undefined;
  const sourceImageIndex = args.sourceImageIndex as number | undefined;

  const config = getModelForControlMode(controlMode);

  // Locate the source video from uploaded files
  const videoFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'video');
  const vidIndex = videoSourceIndex ?? 0;
  const videoFile = videoFiles[vidIndex];
  if (!videoFile) {
    return JSON.stringify({ error: 'no_video', message: 'Please upload a video file first.' });
  }

  // Locate reference image (required for WAN animate modes)
  let referenceImageData: Uint8Array | null = null;
  let referenceImageMime = 'image/jpeg';
  if (config.requiresImage || sourceImageIndex !== undefined) {
    if (sourceImageIndex !== undefined && sourceImageIndex >= 0) {
      const imageFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'image');
      const imgFile = imageFiles[sourceImageIndex];
      if (imgFile) {
        referenceImageData = imgFile.data;
        referenceImageMime = imgFile.mimeType;
      }
    }
    if (!referenceImageData && context.imageData) {
      referenceImageData = context.imageData;
      referenceImageMime = context.uploadedFiles.find(f => f.type === 'image')?.mimeType ?? 'image/jpeg';
    }
    if (!referenceImageData && config.requiresImage) {
      return JSON.stringify({ error: 'no_image', message: 'This control mode requires a reference image. Please upload one.' });
    }
  }

  // Use video dimensions if known, otherwise defaults
  const width = config.defaultWidth;
  const height = config.defaultHeight;
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
    toolName: 'video_to_video',
    totalCount: numberOfMedia,
    estimatedCost,
    videoAspectRatio,
    modelName: mediaLabel,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('video_to_video', estimatedCost, context.tokenType)
    : null;

  try {
    const videoUrls = await tryWithTokenFallback(
      (tokenType: TokenType) => runV2VGeneration(
        context.sogniClient,
        {
          modelId: config.id,
          prompt,
          controlMode,
          sourceVideo: videoFile.data,
          sourceVideoMime: videoFile.mimeType,
          referenceImage: referenceImageData,
          referenceImageMime,
          width,
          height,
          frames,
          fps,
          steps,
          guidance: config.defaultGuidance,
          numberOfMedia,
          tokenType,
          sampler: config.sampler,
          scheduler: config.scheduler,
          disableNSFWFilter: context.safeContentFilter === false,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.completed ? 'completed' : 'progress',
            toolName: 'video_to_video',
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
    callbacks.onToolComplete('video_to_video', [], videoUrls);

    return JSON.stringify({
      success: true,
      resultCount: videoUrls.length,
      mediaType: 'video',
      model: config.name,
      controlMode,
      duration,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully transformed ${videoUrls.length} video${videoUrls.length !== 1 ? 's' : ''} using ${config.name} with "${controlMode}" control. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see and play the video${videoUrls.length !== 1 ? 's' : ''}.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for video-to-video transformation.' });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SDK project execution
// ---------------------------------------------------------------------------

interface V2VParams {
  modelId: string;
  prompt: string;
  controlMode: ControlMode;
  sourceVideo: Uint8Array;
  sourceVideoMime: string;
  referenceImage: Uint8Array | null;
  referenceImageMime: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  steps: number;
  guidance: number;
  numberOfMedia: number;
  tokenType: TokenType;
  sampler: string;
  scheduler: string;
  disableNSFWFilter?: boolean;
}

interface V2VProgress {
  progress?: number;
  completedCount?: number;
  jobIndex?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runV2VGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: V2VParams,
  onProgress: (progress: V2VProgress) => void,
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
    controlNet: { name: params.controlMode },
    referenceVideo: new Blob([params.sourceVideo as BlobPart], { type: params.sourceVideoMime || 'video/mp4' }),
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

    // Safety timeout: 10 minutes
    const safetyTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Video-to-video transformation timed out'));
    }, 600_000);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Video-to-video transformation aborted'));
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
          reject(new Error(`All ${totalJobs} video-to-video jobs failed`));
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
            console.error('[VIDEO TO VIDEO] Job completed with error:', event.error);
          }
          checkDone();
          break;
        }
        case 'error':
        case 'failed': {
          failedCount++;
          console.error('[VIDEO TO VIDEO] Job failed:', event.error);
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
