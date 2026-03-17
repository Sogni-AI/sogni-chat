/**
 * Style transfer service using Qwen Image Edit model
 * Applies artistic styles to already-restored images
 */
import { SogniClient } from '@sogni-ai/sogni-client';
import { TokenType } from '@/types/wallet';
import { QUALITY_PRESETS, type QualityTier } from '@/config/qualityPresets';
import type { ModelOverride } from './imageGeneration';
import { projectSessionMap } from '@/services/projectSessionMap';

interface StyleTransferParams {
  imageData: Uint8Array;
  width: number;
  height: number;
  tokenType: TokenType;
  stylePrompt: string;
  outputFormat?: 'jpg' | 'png';
  qualityTier?: QualityTier;
  /** When provided, bypasses quality-tier model selection */
  modelOverride?: ModelOverride;
}

interface StyleTransferProgress {
  type: string;
  progress?: number;
  resultUrl?: string;
  error?: any;
}

/**
 * Apply a style to an image using Qwen Image Edit model
 * Returns 1 styled variation
 */
export async function applyStyle(
  sogniClient: SogniClient,
  params: StyleTransferParams,
  onProgress?: (progress: StyleTransferProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string> {
  const {
    imageData,
    width,
    height,
    tokenType,
    stylePrompt,
    outputFormat = 'jpg',
    qualityTier = 'fast',
  } = params;

  if (signal?.aborted) {
    throw new Error('CANCELLED');
  }

  const preset = QUALITY_PRESETS[qualityTier];
  const model = params.modelOverride;

  console.log('[STYLE SERVICE] Starting style transfer...', {
    imageDataSize: imageData.length,
    width,
    height,
    tokenType,
    stylePrompt,
    qualityTier,
    modelOverride: model?.name,
  });

  // Create project with the selected model (quality-preset or override)
  const projectConfig: any = {
    type: 'image',
    testnet: false,
    tokenType: tokenType,
    modelId: model?.modelId ?? preset.model,
    positivePrompt: stylePrompt,
    negativePrompt: '',
    stylePrompt: '',
    sizePreset: 'custom',
    width,
    height,
    steps: model?.steps ?? preset.steps,
    guidance: model?.guidance ?? preset.guidance,
    numberOfMedia: 1,
    outputFormat,
    disableNSFWFilter: true,
    contextImages: [imageData],
    sourceType: 'style-transfer'
  };

  console.log('[STYLE SERVICE] Creating style transfer project...', {
    config: {
      ...projectConfig,
      contextImages: `[Uint8Array(${imageData.length} bytes)]`
    }
  });

  const startTime = Date.now();
  let project;

  try {
    project = await sogniClient.projects.create(projectConfig);
    if (sessionId) void projectSessionMap.register(project.id, sessionId);
    console.log(`[STYLE SERVICE] Project created in ${Date.now() - startTime}ms:`, {
      projectId: project.id,
      projectStatus: project?.status
    });
  } catch (createError: any) {
    console.error('[STYLE SERVICE] Failed to create project:', createError);
    // Normalize insufficient-credits errors from the SDK
    if (createError?.code === 4024 ||
        (createError?.message && createError.message.toLowerCase().includes('insufficient'))) {
      const err = new Error('INSUFFICIENT_CREDITS') as any;
      err.code = createError.code;
      err.isInsufficientCredits = true;
      throw err;
    }
    throw createError;
  }

  // Activity-based inactivity timeout (reset on every progress event)
  const INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes of no activity
  const ACTIVITY_CHECK_INTERVAL_MS = 15_000; // check every 15s
  let lastActivityTime = Date.now();

  return new Promise((resolve, reject) => {
    let resolved = false;

    const finishReject = (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearInterval(activityCheckId);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      reject(error);
    };

    // Abort signal handling
    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => {
        console.log('[STYLE SERVICE] Abort signal received, cancelling project...');
        try { project.cancel?.(); } catch (e) { console.warn('[STYLE SERVICE] Error cancelling project:', e); }
        finishReject(new Error('CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Listen to project progress
    project.on('progress', (progress: any) => {
      lastActivityTime = Date.now();
      const progressValue = typeof progress === 'number' ? progress :
        (progress?.progress !== undefined) ? progress.progress : 0;
      const normalizedProgress = progressValue > 1 ? progressValue / 100 : progressValue;

      console.log(`[STYLE SERVICE] Progress: ${Math.floor(normalizedProgress * 100)}%`);

      if (onProgress) {
        onProgress({
          type: 'progress',
          progress: normalizedProgress
        });
      }
    });

    // Listen to job completion
    project.on('jobCompleted', (job: any) => {
      console.log('[STYLE SERVICE] Job completed:', {
        jobId: job.id,
        hasResultUrl: !!job?.resultUrl,
        isNSFW: job?.isNSFW
      });

      if (job.resultUrl && !resolved) {
        resolved = true;
        clearInterval(activityCheckId);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);

        if (onProgress) {
          onProgress({
            type: 'completed',
            progress: 1,
            resultUrl: job.resultUrl
          });
        }

        resolve(job.resultUrl);
      } else if (!job.resultUrl && !resolved) {
        // NSFW-filtered or missing result
        const isNSFW = job?.isNSFW || job?.nsfwFiltered;
        const errorMessage = isNSFW
          ? 'Content was filtered by the safety checker. Please try a different style.'
          : 'Style transfer completed but no result was returned.';
        console.warn(`[STYLE SERVICE] ${errorMessage}`, { jobId: job?.id, isNSFW });
        finishReject(new Error(errorMessage));
      }
    });

    // Listen to job failure
    project.on('jobFailed', (job: any) => {
      console.error('[STYLE SERVICE] Job failed:', job);
      const error = job?.error;
      let errorMessage = 'Style transfer failed';
      if (error?.code === 4024 || error?.message?.toLowerCase().includes('insufficient')) {
        errorMessage = 'INSUFFICIENT_CREDITS';
      } else if (error?.message) {
        errorMessage = error.message;
      }
      finishReject(new Error(errorMessage));
    });

    // Listen to project failure
    (project as any).on('failed', (error: any) => {
      console.error('[STYLE SERVICE] Project failed:', error);
      finishReject(new Error(error?.message || 'Style transfer failed'));
    });

    // Inactivity-based timeout: check every 15s, timeout after 2 min of no activity
    const activityCheckId = setInterval(() => {
      if (resolved) return;
      const inactivitySec = (Date.now() - lastActivityTime) / 1000;
      if (inactivitySec > INACTIVITY_TIMEOUT_MS / 1000) {
        console.error(`[STYLE SERVICE] Style transfer timed out — no activity for ${inactivitySec.toFixed(0)}s`);
        finishReject(new Error('Style transfer timed out'));
      }
    }, ACTIVITY_CHECK_INTERVAL_MS);
  });
}
