/**
 * Handler for generate_video tool.
 * Based on workflow_text_to_video.mjs — text-to-video without a source image.
 *
 * Includes a creative prompt refinement step: when the LLM-generated prompt
 * contains dialogue, character references, narrative elements, or is too
 * shallow for the requested duration, a thinking-mode LLM sub-call expands
 * it into a detailed, production-quality video prompt with actual dialogue,
 * scene staging, and sensory detail.
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
  withTimeout,
  LLM_THINKING_TIMEOUT_MS,
  needsCreativeRefinement,
  refineVideoPrompt,
} from '../shared';
import type { TokenType } from '@/types/wallet';
import { parseAspectRatio } from '@/utils/imageDimensions';
import { fetchVideoCostEstimate } from '@/services/creditsService';
import { projectSessionMap } from '@/services/projectSessionMap';

// ---------------------------------------------------------------------------
// T2V model configurations (from MODELS.t2v in workflow-helpers.mjs)
// ---------------------------------------------------------------------------

interface T2VModelConfig {
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
  hasAudio?: boolean;
}

const T2V_MODELS: Record<string, T2VModelConfig> = {
  ltx23: {
    id: 'ltx23-22b-fp8_t2v_distilled',
    name: 'LTX 2.3 22B T2V Distilled',
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
    hasAudio: true,
  },
  wan22: {
    id: 'wan_v2.2-14b-fp8_t2v_lightx2v',
    name: 'WAN 2.2 T2V LightX2V',
    defaultWidth: 640,
    defaultHeight: 640,
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
    shift: 5.0,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFrames(duration: number, config: T2VModelConfig): number {
  const isWan = config.id.startsWith('wan_');
  const internalFps = isWan ? 16 : config.defaultFps;
  let frames = Math.round(duration * internalFps) + 1;

  // LTX 2.3 frame step: frames = 1 + n*8
  if (!isWan && config.frameStep > 1) {
    const n = Math.round((frames - 1) / config.frameStep);
    frames = n * config.frameStep + 1;
  }

  frames = Math.max(config.minFrames, Math.min(config.maxFrames, frames));
  return frames;
}

function computeDimensions(
  requestedW: number | undefined,
  requestedH: number | undefined,
  aspectRatio: string | undefined,
  config: T2VModelConfig,
  targetResolution?: number,
): { width: number; height: number } {
  let w = requestedW ?? config.defaultWidth;
  let h = requestedH ?? config.defaultHeight;

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
  const rawModelKey = (args.videoModel as string) || 'ltx23';
  const modelKey = T2V_MODELS[rawModelKey] ? rawModelKey : 'ltx23';
  let duration = Math.max(2, Math.min(20, (args.duration as number) || 5));
  const explicitDuration = args.duration !== undefined;
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const aspectRatio = args.aspectRatio as string | undefined;

  const config = T2V_MODELS[modelKey];

  // Quality-based resolution: Standard (fast) -> 720p (768), High (hq) -> 1080p (1088)
  // Skip quality tier scaling when user explicitly requested dimensions — their
  // request should always trump the default media quality setting.
  const isLTX = modelKey.startsWith('ltx');
  const hasExplicitDimensions = args.width !== undefined || args.height !== undefined
    || parseAspectRatio(aspectRatio)?.type === 'exact';
  const qualityTier = context.qualityTier || 'fast';
  const targetResolution = isLTX && !hasExplicitDimensions
    ? (qualityTier === 'hq' ? 1088 : 768)
    : undefined;

  const { width, height } = computeDimensions(
    args.width as number | undefined,
    args.height as number | undefined,
    aspectRatio,
    config,
    targetResolution,
  );
  const fps = config.defaultFps;
  const steps = config.defaultSteps;

  const videoAspectRatio = `${width} / ${height}`;

  // Creative prompt refinement: expand shallow/intent-level prompts
  // into detailed, production-quality video prompts with actual dialogue,
  // character descriptions, scene staging, and sensory detail.
  let composedPrompt = prompt;
  if (isLTX && needsCreativeRefinement(prompt, duration)) {
    const mediaLabel = `${config.name} — ${duration}s @ ${width}x${height}`;
    callbacks.onToolProgress({
      type: 'started',
      toolName: 'generate_video',
      totalCount: numberOfMedia,
      stepLabel: 'Crafting detailed prompt',
      videoAspectRatio,
      modelName: mediaLabel,
    });
    const refinementResult = await withTimeout(
      refineVideoPrompt(context.sogniClient, prompt, duration, context.tokenType, '[GENERATE VIDEO]', context.signal, false, '', explicitDuration),
      LLM_THINKING_TIMEOUT_MS,
      'Video prompt refinement',
    );
    composedPrompt = refinementResult?.refinedPrompt ?? prompt;
    if (refinementResult?.suggestedDuration) {
      duration = refinementResult.suggestedDuration;
    }
  }

  // Compute frames AFTER refinement — duration may have been adjusted for dialogue fitting
  const frames = computeFrames(duration, config);
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
    toolName: 'generate_video',
    totalCount: numberOfMedia,
    estimatedCost,
    videoAspectRatio,
    modelName: mediaLabel,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('generate_video', estimatedCost, context.tokenType)
    : null;

  try {
    const videoUrls = await tryWithTokenFallback(
      (tokenType: TokenType) => runT2VGeneration(
        context.sogniClient,
        {
          modelId: config.id,
          prompt: composedPrompt,
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
            toolName: 'generate_video',
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
        context.sessionId,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);
    callbacks.onToolComplete('generate_video', [], videoUrls);

    return JSON.stringify({
      success: true,
      resultCount: videoUrls.length,
      mediaType: 'video',
      model: config.name,
      duration,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${videoUrls.length} ${duration}-second video${videoUrls.length !== 1 ? 's' : ''} using ${config.name}${config.hasAudio ? ' (with audio)' : ''}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see and play the video${videoUrls.length !== 1 ? 's' : ''}.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for video generation.' });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SDK project execution
// ---------------------------------------------------------------------------

interface T2VParams {
  modelId: string;
  prompt: string;
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

interface VideoProgress {
  progress?: number;
  completedCount?: number;
  jobIndex?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runT2VGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: T2VParams,
  onProgress: (progress: VideoProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
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
    sampler: params.sampler,
    scheduler: params.scheduler,
    tokenType: params.tokenType,
    disableNSFWFilter: !!params.disableNSFWFilter,
  };

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
  if (sessionId) void projectSessionMap.register(project.id, sessionId);

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

    // Activity-based inactivity timeout: reject if no progress/ETA for 4 min
    let lastActivityTime = Date.now();
    const INACTIVITY_TIMEOUT_MS = 240_000; // 4 minutes
    const inactivityCheck = setInterval(() => {
      const idleMs = Date.now() - lastActivityTime;
      if (idleMs >= INACTIVITY_TIMEOUT_MS) {
        console.warn(`[GENERATE VIDEO] No activity for ${(idleMs / 1000).toFixed(0)}s — timing out`);
        cleanup();
        if (resultUrls.length > 0) {
          resolve(resultUrls.filter(Boolean));
        } else {
          reject(new Error('Video generation timed out (no activity)'));
        }
      }
    }, 30_000);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Video generation aborted'));
    };

    const cleanup = () => {
      clearInterval(inactivityCheck);
      signal?.removeEventListener('abort', abortHandler);
      projects.off('job', jobHandler);
      projects.off('project', projectHandler);
    };

    const checkDone = () => {
      if (completedCount + failedCount >= totalJobs) {
        cleanup();
        if (failedCount === totalJobs) {
          reject(new Error(`All ${totalJobs} video generation jobs failed`));
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
          lastActivityTime = Date.now();
          const step = event.step as number | undefined;
          const stepCount = event.stepCount as number | undefined;
          if (step !== undefined && stepCount !== undefined && stepCount > 0) {
            onProgress({ progress: step / stepCount, jobIndex: event.jobId ? jobIdToIndex.get(event.jobId as string) : undefined });
          }
          break;
        }
        case 'jobETA': {
          lastActivityTime = Date.now();
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
            console.error('[GENERATE VIDEO] Job completed with error:', event.error);
          }
          checkDone();
          break;
        }
        case 'error':
        case 'failed': {
          failedCount++;
          console.error('[GENERATE VIDEO] Job failed:', event.error);
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
