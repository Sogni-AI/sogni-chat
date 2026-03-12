/**
 * Angle generation service using Multiple Angles LoRA with Qwen Image Edit.
 * Generates the uploaded photo from a different camera angle/perspective.
 */
import { SogniClient } from '@sogni-ai/sogni-client';
import { TokenType } from '@/types/wallet';
import { QUALITY_PRESETS, type QualityTier } from '@/config/qualityPresets';
import { calculateOutputDimensions } from '@/utils/imageDimensions';

/** LoRA ID for multiple angles (resolved to filename by worker via config API) */
const LORA_ID = 'multiple_angles';

/** Default LoRA strength */
const DEFAULT_LORA_STRENGTH = 0.9;

export interface AngleGenerationParams {
  imageData: Uint8Array;
  width: number;
  height: number;
  tokenType: TokenType;
  /** Camera angle description from the LLM (e.g., "front-right quarter view, eye-level shot, medium shot") */
  description: string;
  /** Quality tier determines model selection */
  qualityTier?: QualityTier;
  /** Target aspect ratio or exact dimensions (e.g. "16:9", "1920x1080") */
  aspectRatio?: string;
  /** LoRA strength override (0.1-1.0). Lower = preserve original, higher = stronger angle changes. */
  loraStrength?: number;
}

export interface AngleGenerationProgress {
  type: 'started' | 'progress' | 'completed' | 'error' | 'jobETA';
  progress?: number;
  resultUrl?: string;
  error?: string;
  etaSeconds?: number;
}

/**
 * Generate the photo from a different camera angle using the Multiple Angles LoRA.
 * Returns the result image URL on completion.
 */
export async function generateAngle(
  sogniClient: SogniClient,
  params: AngleGenerationParams,
  onProgress?: (progress: AngleGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('CANCELLED');
  }

  const {
    imageData,
    width,
    height,
    tokenType,
    description,
    qualityTier = 'fast',
    aspectRatio,
    loraStrength,
  } = params;

  const preset = QUALITY_PRESETS[qualityTier];

  // Preserve source aspect ratio within model constraints (unless overridden)
  const outputDims = calculateOutputDimensions(width, height, { aspectRatio });

  // Build prompt with LoRA activation keyword
  const fullPrompt = `<sks> ${description}`;

  const effectiveLoraStrength = loraStrength !== undefined
    ? Math.max(0.1, Math.min(1.0, loraStrength))
    : DEFAULT_LORA_STRENGTH;

  console.log('[ANGLE SERVICE] Starting angle generation...', {
    prompt: fullPrompt,
    model: preset.model,
    qualityTier,
    loraStrength: effectiveLoraStrength,
    inputDimensions: `${width}x${height}`,
    outputDimensions: `${outputDims.width}x${outputDims.height}`,
  });

  const projectConfig: any = {
    type: 'image',
    modelId: preset.model,
    positivePrompt: fullPrompt,
    negativePrompt: '',
    numberOfMedia: 1,
    steps: preset.steps,
    guidance: preset.guidance,
    seed: -1,
    contextImages: [imageData],
    tokenType,
    sizePreset: 'custom',
    width: outputDims.width,
    height: outputDims.height,
    outputFormat: 'jpg',
    disableNSFWFilter: true,
    sampler: 'euler',
    scheduler: 'simple',
    // LoRA configuration
    loras: [LORA_ID],
    loraStrengths: [effectiveLoraStrength],
  };

  const startTime = Date.now();
  let project: any;

  try {
    project = await sogniClient.projects.create(projectConfig);
    console.log(`[ANGLE SERVICE] Project created in ${Date.now() - startTime}ms: ${project.id}`);
  } catch (createError: any) {
    console.error('[ANGLE SERVICE] Failed to create project:', createError);
    if (
      createError?.code === 4024 ||
      (createError?.message && createError.message.toLowerCase().includes('insufficient'))
    ) {
      const err = new Error('INSUFFICIENT_CREDITS') as any;
      err.code = createError.code;
      err.isInsufficientCredits = true;
      throw err;
    }
    throw createError;
  }

  if (onProgress) {
    onProgress({ type: 'started' });
  }

  // Activity-based inactivity timeout (reset on every progress/ETA event)
  const INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes of no activity
  const ACTIVITY_CHECK_INTERVAL_MS = 15_000; // check every 15s
  let lastActivityTime = Date.now();

  return new Promise((resolve, reject) => {
    let resolved = false;
    const projectsApi = sogniClient.projects as any;

    // Abort signal handling
    let onAbort: (() => void) | null = null;

    const cleanup = () => {
      if (projectsApi && typeof projectsApi.off === 'function') {
        projectsApi.off('job', globalJobHandler);
      }
      project.off('jobCompleted', jobCompletedHandler);
      project.off('jobFailed', jobFailedHandler);
      (project as any).off?.('failed', projectFailedHandler);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      clearInterval(activityCheckId);
    };

    const finishResolve = (url: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(url);
    };

    const finishReject = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    if (signal) {
      onAbort = () => {
        console.log('[ANGLE SERVICE] Abort signal received, cancelling project...');
        try { project.cancel?.(); } catch (e) { console.warn('[ANGLE SERVICE] Error cancelling project:', e); }
        finishReject(new Error('CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Global job event handler for progress
    const globalJobHandler = (event: any) => {
      if (event.projectId !== project.id) return;

      if (event.type === 'progress' && event.step !== undefined && event.stepCount !== undefined) {
        lastActivityTime = Date.now();
        const normalizedProgress = event.step / event.stepCount;
        if (onProgress) {
          onProgress({ type: 'progress', progress: normalizedProgress });
        }
      }

      if (event.type === 'jobETA' && event.etaSeconds !== undefined) {
        lastActivityTime = Date.now();
        if (onProgress) {
          onProgress({ type: 'jobETA', etaSeconds: event.etaSeconds });
        }
      }

      if (event.type === 'completed') {
        const resultUrl = event.resultUrl;
        if (resultUrl) {
          if (onProgress) {
            onProgress({ type: 'completed', progress: 1, resultUrl });
          }
          finishResolve(resultUrl);
        } else {
          const isNSFW = event.isNSFW || event.nsfwFiltered;
          const errorMessage = isNSFW
            ? 'Content was filtered by the safety checker. Please try a different description.'
            : 'Angle generation completed but no result was returned.';
          console.warn(`[ANGLE SERVICE] ${errorMessage}`, { jobId: event.jobId, isNSFW });
          finishReject(new Error(errorMessage));
        }
      }
    };

    if (projectsApi && typeof projectsApi.on === 'function') {
      projectsApi.on('job', globalJobHandler);
    }

    // Project-level job completion (backup)
    const jobCompletedHandler = (job: any) => {
      if (job.resultUrl && !resolved) {
        if (onProgress) {
          onProgress({ type: 'completed', progress: 1, resultUrl: job.resultUrl });
        }
        finishResolve(job.resultUrl);
      } else if (!job.resultUrl && !resolved) {
        const isNSFW = job?.isNSFW || job?.nsfwFiltered;
        const errorMessage = isNSFW
          ? 'Content was filtered by the safety checker. Please try a different description.'
          : 'Angle generation completed but no result was returned.';
        console.warn(`[ANGLE SERVICE] ${errorMessage}`, { jobId: job?.id, isNSFW });
        finishReject(new Error(errorMessage));
      }
    };
    project.on('jobCompleted', jobCompletedHandler);

    // Job failure
    const jobFailedHandler = (job: any) => {
      console.error('[ANGLE SERVICE] Job failed:', job?.error);
      if (!resolved) {
        const error = job?.error;
        if (
          error?.code === 4024 ||
          error?.message?.toLowerCase().includes('insufficient')
        ) {
          const err = new Error('INSUFFICIENT_CREDITS') as any;
          err.code = error.code;
          err.isInsufficientCredits = true;
          finishReject(err);
          return;
        }
        finishReject(new Error(error?.message || 'Angle generation failed'));
      }
    };
    project.on('jobFailed', jobFailedHandler);

    // Project failure
    const projectFailedHandler = (error: any) => {
      console.error('[ANGLE SERVICE] Project failed:', error);
      if (!resolved) {
        finishReject(new Error(error?.message || 'Angle generation failed'));
      }
    };
    (project as any).on('failed', projectFailedHandler);

    // Inactivity-based timeout: check every 15s, timeout after 2 min of no activity
    const activityCheckId = setInterval(() => {
      if (resolved) return;
      const inactivitySec = (Date.now() - lastActivityTime) / 1000;
      if (inactivitySec > INACTIVITY_TIMEOUT_MS / 1000) {
        console.error(`[ANGLE SERVICE] Angle generation timed out — no activity for ${inactivitySec.toFixed(0)}s`);
        finishReject(new Error('Angle generation timed out'));
      }
    }, ACTIVITY_CHECK_INTERVAL_MS);
  });
}
