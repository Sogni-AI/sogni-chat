/**
 * Restoration service using Qwen Image Edit model.
 *
 * When no custom prompt is provided the service creates one project per
 * restoration preset (Gentle Restore, Deep Clean, Color Revival, Full Remaster)
 * so each generation uses a genuinely different prompt.
 *
 * When a custom prompt IS provided (e.g. from chat) it falls back to a single
 * project with numberOfMedia copies of that prompt.
 */
import { SogniClient } from '@sogni-ai/sogni-client';
import { TokenType } from '@/types/wallet';
import { getPresetsForCount, type RestorationPreset, type RestorationModeId } from '@/config/restorationPresets';
import { QUALITY_PRESETS, DEFAULT_QUALITY, type QualityTier } from '@/config/qualityPresets';
import { projectSessionMap } from '@/services/projectSessionMap';

/** Override the quality-preset model with explicit model/steps/guidance */
export interface ModelOverride {
  modelId: string;
  name: string;
  steps: number;
  guidance: number;
}

interface RestorationParams {
  imageData: Uint8Array;
  width: number;
  height: number;
  tokenType: TokenType;
  customPrompt?: string;
  outputFormat?: 'jpg' | 'png';
  numberOfMedia?: number;
  qualityTier?: QualityTier;
  restorationMode?: RestorationModeId;
  /** When provided, bypasses quality-tier model selection */
  modelOverride?: ModelOverride;
}

export interface RestorationProgress {
  type: string;
  progress?: number;
  jobId?: string;
  jobIndex?: number; // CRITICAL: Index in the placeholder array (photobooth pattern)
  resultUrl?: string;
  error?: any;
  etaSeconds?: number; // Time remaining in seconds from jobETA event
  completedCount?: number; // Number of images completed so far
  totalCount?: number; // Total number of images expected
  projectId?: string; // Project ID for tracking styled images
  presetLabel?: string; // Label of the restoration preset used for this slot
}

// --- Shared helpers ----

function normalizeInsufficientCreditsError(err: any): never {
  if (err?.code === 4024 ||
      (err?.message && err.message.toLowerCase().includes('insufficient'))) {
    const error = new Error('INSUFFICIENT_CREDITS') as any;
    error.code = err.code;
    error.isInsufficientCredits = true;
    throw error;
  }
  throw err;
}

function buildProjectConfig(
  prompt: string,
  params: {
    tokenType: TokenType;
    width: number;
    height: number;
    outputFormat: string;
    numberOfMedia: number;
    imageData: Uint8Array;
    qualityTier: QualityTier;
    modelOverride?: ModelOverride;
  }
): any {
  const preset = QUALITY_PRESETS[params.qualityTier];
  const model = params.modelOverride;
  return {
    type: 'image',
    testnet: false,
    tokenType: params.tokenType,
    modelId: model?.modelId ?? preset.model,
    positivePrompt: prompt,
    negativePrompt: '',
    stylePrompt: '',
    sizePreset: 'custom',
    width: params.width,
    height: params.height,
    steps: model?.steps ?? preset.steps,
    guidance: model?.guidance ?? preset.guidance,
    numberOfMedia: params.numberOfMedia,
    outputFormat: params.outputFormat,
    disableNSFWFilter: true,
    contextImages: [params.imageData],
    sourceType: 'enhancement-qwen-image-edit',
  };
}

// --- Multi-preset restoration (default flow) ---

/**
 * Create one project per preset prompt and merge results into a single
 * ordered array matching the preset indices.
 */
async function restoreWithPresets(
  sogniClient: SogniClient,
  presets: RestorationPreset[],
  params: Omit<RestorationParams, 'customPrompt' | 'numberOfMedia'> & { outputFormat: string; qualityTier: QualityTier },
  onProgress?: (progress: RestorationProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  const totalCount = presets.length;
  const resultUrls: (string | null)[] = new Array(totalCount).fill(null);
  let failedCount = 0;
  let resolved = false;
  const projectsApi = sogniClient.projects as any;

  // We'll track one global job handler for all projects
  const projectIdToSlot = new Map<string, number>();
  const activeProjects: any[] = []; // Track projects for cancellation

  if (signal?.aborted) {
    return Promise.reject(new Error('CANCELLED'));
  }

  // Activity-based inactivity timeout (reset on every progress/ETA event)
  const INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes of no activity
  const ACTIVITY_CHECK_INTERVAL_MS = 15_000; // check every 15s
  let lastActivityTime = Date.now();

  return new Promise<string[]>((resolve, reject) => {
    const finishResolve = (urls: string[]) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(urls);
    };

    const finishReject = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    // Check if all slots are settled (completed or failed)
    const checkDone = () => {
      const completedCount = resultUrls.filter(u => u !== null).length;
      if (completedCount + failedCount >= totalCount) {
        const finalUrls = resultUrls.filter(url => url !== null) as string[];
        if (finalUrls.length > 0) {
          console.log(`[RESTORE SERVICE] All preset jobs done. ${finalUrls.length}/${totalCount} succeeded.`);
          finishResolve(finalUrls);
        } else {
          finishReject(new Error('All restoration jobs failed'));
        }
      }
    };

    // -- Global job event handler (works for all projects) --
    const globalJobHandler = (event: any) => {
      const slot = projectIdToSlot.get(event.projectId);
      if (slot === undefined) return;

      if (event.type === 'progress' && event.step && event.stepCount) {
        lastActivityTime = Date.now();
        const normalizedProgress = event.step / event.stepCount;
        if (onProgress) {
          onProgress({
            type: 'progress',
            jobId: event.jobId,
            jobIndex: slot,
            progress: normalizedProgress,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount,
          });
        }
      }

      if (event.type === 'jobETA' && event.etaSeconds !== undefined) {
        lastActivityTime = Date.now();
        if (onProgress) {
          onProgress({
            type: 'jobETA',
            jobId: event.jobId,
            jobIndex: slot,
            etaSeconds: event.etaSeconds,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount,
          });
        }
      }

      if (event.type === 'completed') {
        const resultUrl = event.resultUrl || null;
        if (resultUrl && resultUrls[slot] === null) {
          resultUrls[slot] = resultUrl;
          if (onProgress) {
            onProgress({
              type: 'completed',
              jobId: event.jobId,
              jobIndex: slot,
              resultUrl,
              completedCount: resultUrls.filter(u => u !== null).length,
              totalCount,
              presetLabel: presets[slot].label,
            });
          }
        } else if (!resultUrl) {
          failedCount++;
          const isNSFW = event.isNSFW || event.nsfwFiltered;
          console.warn(`[RESTORE SERVICE] Preset "${presets[slot].label}" job completed with no resultUrl`, { isNSFW, jobId: event.jobId });
        }
        checkDone();
      }

      if (event.type === 'failed') {
        const error = event.error;
        if (error?.code === 4024 ||
            (error?.message && error.message.toLowerCase().includes('insufficient'))) {
          const restorationError = new Error('INSUFFICIENT_CREDITS') as any;
          restorationError.code = error.code;
          restorationError.isInsufficientCredits = true;
          finishReject(restorationError);
          return;
        }
        failedCount++;
        console.error(`[RESTORE SERVICE] Preset "${presets[slot].label}" job failed:`, error);
        checkDone();
      }
    };

    // Subscribe to the global job event bus
    if (projectsApi && typeof projectsApi.on === 'function') {
      projectsApi.on('job', globalJobHandler);
    }

    // -- Abort signal handling --
    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => {
        console.log('[RESTORE SERVICE] Abort signal received, cancelling projects...');
        for (const project of activeProjects) {
          try { project.cancel?.(); } catch (e) { console.warn('[RESTORE SERVICE] Error cancelling project:', e); }
        }
        finishReject(new Error('CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (projectsApi && typeof projectsApi.off === 'function') {
        projectsApi.off('job', globalJobHandler);
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      clearInterval(activityCheckId);
      clearTimeout(noEventTimeoutId);
    };

    // -- Create all projects concurrently --
    const startTime = Date.now();
    console.log(`[RESTORE SERVICE] Creating ${totalCount} preset projects concurrently`);

    Promise.all(
      presets.map(async (preset, slot) => {
        const config = buildProjectConfig(preset.prompt, {
          tokenType: params.tokenType,
          width: params.width,
          height: params.height,
          outputFormat: params.outputFormat,
          numberOfMedia: 1,
          imageData: params.imageData,
          qualityTier: params.qualityTier,
        });

        try {
          const project = await sogniClient.projects.create(config);
          if (sessionId) void projectSessionMap.register(project.id, sessionId);
          activeProjects.push(project);
          projectIdToSlot.set(project.id, slot);
          console.log(`[RESTORE SERVICE] Preset "${preset.label}" project created: ${project.id} (${Date.now() - startTime}ms)`);

          // Notify about this slot starting
          if (onProgress) {
            onProgress({
              type: 'started',
              projectId: project.id,
              jobIndex: slot,
              totalCount,
              presetLabel: preset.label,
            });
          }

          // Also listen to project-level events as backup
          project.on('jobCompleted', (job: any) => {
            const resultUrl = job.resultUrl || null;
            if (resultUrl && resultUrls[slot] === null) {
              resultUrls[slot] = resultUrl;
              if (onProgress) {
                onProgress({
                  type: 'completed',
                  jobId: job.id,
                  jobIndex: slot,
                  resultUrl,
                  completedCount: resultUrls.filter(u => u !== null).length,
                  totalCount,
                  presetLabel: preset.label,
                });
              }
            } else if (!resultUrl) {
              failedCount++;
            }
            checkDone();
          });

          project.on('jobFailed', (job: any) => {
            const error = job?.error;
            if (error?.code === 4024 ||
                (error?.message && error.message.toLowerCase().includes('insufficient'))) {
              const restorationError = new Error('INSUFFICIENT_CREDITS') as any;
              restorationError.code = error.code;
              restorationError.isInsufficientCredits = true;
              finishReject(restorationError);
              return;
            }
            failedCount++;
            console.error(`[RESTORE SERVICE] Preset "${preset.label}" job failed:`, error);
            checkDone();
          });

          (project as any).on?.('failed', (error: any) => {
            console.error(`[RESTORE SERVICE] Preset "${preset.label}" project failed:`, error);
            failedCount++;
            checkDone();
          });
        } catch (createError: any) {
          normalizeInsufficientCreditsError(createError);
        }
      })
    ).catch((err) => {
      finishReject(err);
    });

    // No-events warning timeout
    const noEventTimeoutId = setTimeout(() => {
      if (resultUrls.filter(u => u !== null).length === 0 && !resolved) {
        console.warn('[RESTORE SERVICE] No events received after 10 seconds');
      }
    }, 10000);

    // Inactivity-based timeout: check every 15s, timeout after 2 min of no activity
    const activityCheckId = setInterval(() => {
      if (resolved) return;
      const inactivitySec = (Date.now() - lastActivityTime) / 1000;
      if (inactivitySec > INACTIVITY_TIMEOUT_MS / 1000) {
        const finalUrls = resultUrls.filter(url => url !== null) as string[];
        if (finalUrls.length > 0) {
          console.warn(`[RESTORE SERVICE] No activity for ${inactivitySec.toFixed(0)}s, resolving with ${finalUrls.length} partial results`);
          finishResolve(finalUrls);
        } else {
          console.error(`[RESTORE SERVICE] Restoration timed out — no activity for ${inactivitySec.toFixed(0)}s`);
          finishReject(new Error('Restoration timed out'));
        }
      }
    }, ACTIVITY_CHECK_INTERVAL_MS);
  });
}

// --- Single-prompt restoration (custom prompt / chat flow) ---

/**
 * Original single-project behavior: one project, N copies of the same prompt.
 * Used when a custom prompt is provided (e.g. from the chat tool calling flow).
 */
async function restoreWithSinglePrompt(
  sogniClient: SogniClient,
  prompt: string,
  params: Omit<RestorationParams, 'customPrompt'> & { outputFormat: string; numberOfMedia: number; qualityTier: QualityTier },
  onProgress?: (progress: RestorationProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  const { numberOfMedia } = params;
  const config = buildProjectConfig(prompt, {
    tokenType: params.tokenType,
    width: params.width,
    height: params.height,
    outputFormat: params.outputFormat,
    numberOfMedia,
    imageData: params.imageData,
    qualityTier: params.qualityTier,
    modelOverride: params.modelOverride,
  });

  if (signal?.aborted) {
    throw new Error('CANCELLED');
  }

  console.log('[RESTORE SERVICE] Creating single-prompt restoration project');

  const startTime = Date.now();
  let project;
  try {
    project = await sogniClient.projects.create(config);
    if (sessionId) void projectSessionMap.register(project.id, sessionId);
  } catch (createError: any) {
    normalizeInsufficientCreditsError(createError);
  }
  console.log(`[RESTORE SERVICE] Project created in ${Date.now() - startTime}ms: ${project.id}`);

  // Activity-based inactivity timeout (reset on every progress/ETA event)
  const SP_INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes of no activity
  const SP_ACTIVITY_CHECK_INTERVAL_MS = 15_000; // check every 15s
  let spLastActivityTime = Date.now();

  return new Promise((resolve, reject) => {
    let resolved = false;
    const resultUrls: string[] = new Array(numberOfMedia).fill(null);
    const expectedResults = numberOfMedia;
    let failedCount = 0;
    let lastETA: number | undefined = undefined;
    const jobMap = new Map<string, number>();
    const urlSet = new Set<string>();
    const projectsApi = sogniClient.projects as any;

    // -- Abort signal handling --
    let onAbort: (() => void) | null = null;

    const cleanup = () => {
      if (projectsApi && typeof projectsApi.off === 'function') {
        projectsApi.off('job', globalJobHandler);
      }
      project.off('jobStarted', jobStartedHandler);
      project.off('progress', progressHandler);
      project.off('jobCompleted', jobCompletedHandler);
      project.off('jobFailed', jobFailedHandler);
      (project as any).off?.('failed', projectFailedHandler);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      clearInterval(spActivityCheckId);
      clearTimeout(noEventTimeoutId);
    };

    const finishResolve = (urls: string[]) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(urls);
    };

    const finishReject = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    if (signal) {
      onAbort = () => {
        console.log('[RESTORE SERVICE] Abort signal received, cancelling project...');
        try { project.cancel?.(); } catch (e) { console.warn('[RESTORE SERVICE] Error cancelling project:', e); }
        finishReject(new Error('CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (onProgress) {
      onProgress({ type: 'started', projectId: project.id, totalCount: numberOfMedia });
    }

    if (project.jobs && project.jobs.length > 0) {
      project.jobs.forEach((job: any, index: number) => {
        jobMap.set(job.id, index);
      });
    }

    const jobStartedHandler = (job: any) => {
      if (!jobMap.has(job.id)) {
        jobMap.set(job.id, jobMap.size);
      }
    };
    project.on('jobStarted', jobStartedHandler);

    const handleJobResult = (jobId: string, resultUrl: string | null) => {
      const jobIndex = jobMap.get(jobId);
      if (jobIndex === undefined) return;

      if (resultUrl && !urlSet.has(resultUrl) && jobIndex >= 0 && jobIndex < resultUrls.length) {
        resultUrls[jobIndex] = resultUrl;
        urlSet.add(resultUrl);

        if (onProgress) {
          onProgress({
            type: 'completed',
            jobId,
            jobIndex,
            resultUrl,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount: expectedResults,
          });
        }
      } else if (!resultUrl) {
        failedCount++;
        console.warn(`[RESTORE SERVICE] Job ${jobId} completed with no resultUrl (possibly NSFW filtered)`);
      }

      const completedCount = resultUrls.filter(u => u !== null).length;
      if (completedCount + failedCount >= expectedResults) {
        const finalUrls = resultUrls.filter(url => url !== null) as string[];
        if (finalUrls.length > 0) {
          console.log(`[RESTORE SERVICE] All jobs done. ${finalUrls.length}/${expectedResults} succeeded.`);
          finishResolve(finalUrls);
        } else {
          finishReject(new Error('All restoration jobs failed'));
        }
      }
    };

    const globalJobHandler = (event: any) => {
      if (event.projectId !== project.id) return;

      if (event.type === 'progress' && event.step && event.stepCount) {
        spLastActivityTime = Date.now();
        const normalizedProgress = event.step / event.stepCount;
        const jobIndex = jobMap.get(event.jobId);
        if (jobIndex === undefined) return;

        if (onProgress) {
          onProgress({
            type: 'progress',
            jobId: event.jobId,
            jobIndex,
            progress: normalizedProgress,
            etaSeconds: lastETA,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount: expectedResults,
          });
        }
      }

      if (event.type === 'jobETA' && event.etaSeconds !== undefined) {
        spLastActivityTime = Date.now();
        lastETA = event.etaSeconds;
        if (onProgress) {
          onProgress({
            type: 'jobETA',
            jobId: event.jobId,
            etaSeconds: event.etaSeconds,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount: expectedResults,
          });
        }
      }

      if (event.type === 'completed') {
        handleJobResult(event.jobId, event.resultUrl || null);
      }
    };

    if (projectsApi && typeof projectsApi.on === 'function') {
      projectsApi.on('job', globalJobHandler);
    }

    const progressHandler = (progress: any) => {
      spLastActivityTime = Date.now();
      const progressValue = typeof progress === 'number' ? progress :
        (typeof progress === 'object' && progress.progress !== undefined) ? progress.progress : 0;
      const normalizedProgress = progressValue > 1 ? progressValue / 100 : progressValue;

      if (onProgress) {
        onProgress({ type: 'progress', progress: normalizedProgress });
      }
    };
    project.on('progress', progressHandler);

    const jobCompletedHandler = (job: any) => {
      handleJobResult(job.id, job.resultUrl || null);
    };
    project.on('jobCompleted', jobCompletedHandler);

    const jobFailedHandler = (job: any) => {
      console.error('[RESTORE SERVICE] Job failed:', job?.error);
      const error = job?.error;
      if (error?.code === 4024 ||
          (error?.message && error.message.toLowerCase().includes('insufficient'))) {
        const restorationError = new Error('INSUFFICIENT_CREDITS') as any;
        restorationError.code = error.code;
        restorationError.isInsufficientCredits = true;
        finishReject(restorationError);
        return;
      }
      failedCount++;
      const completedCount = resultUrls.filter(u => u !== null).length;
      if (completedCount + failedCount >= expectedResults) {
        const finalUrls = resultUrls.filter(url => url !== null) as string[];
        if (finalUrls.length > 0) {
          console.log(`[RESTORE SERVICE] Partial success: ${finalUrls.length}/${expectedResults}`);
          finishResolve(finalUrls);
        } else {
          const errorMessage = error?.message || 'All restoration jobs failed';
          finishReject(new Error(errorMessage));
        }
      }
    };
    project.on('jobFailed', jobFailedHandler);

    const projectFailedHandler = (error: any) => {
      console.error('[RESTORE SERVICE] Project failed:', error);
      const errorMessage = error?.message || 'Restoration failed';
      const restorationError = new Error(errorMessage) as any;
      restorationError.code = error?.code;
      finishReject(restorationError);
    };
    (project as any).on('failed', projectFailedHandler);

    const noEventTimeoutId = setTimeout(() => {
      if (resultUrls.filter(u => u !== null).length === 0 && !resolved) {
        console.warn('[RESTORE SERVICE] No events received after 10 seconds');
      }
    }, 10000);

    // Inactivity-based timeout: check every 15s, timeout after 2 min of no activity
    const spActivityCheckId = setInterval(() => {
      if (resolved) return;
      const inactivitySec = (Date.now() - spLastActivityTime) / 1000;
      if (inactivitySec > SP_INACTIVITY_TIMEOUT_MS / 1000) {
        const finalUrls = resultUrls.filter(url => url !== null) as string[];
        if (finalUrls.length > 0) {
          console.warn(`[RESTORE SERVICE] No activity for ${inactivitySec.toFixed(0)}s, resolving with ${finalUrls.length} partial results`);
          finishResolve(finalUrls);
        } else {
          console.error(`[RESTORE SERVICE] Restoration timed out — no activity for ${inactivitySec.toFixed(0)}s`);
          finishReject(new Error('Restoration timed out'));
        }
      }
    }, SP_ACTIVITY_CHECK_INTERVAL_MS);
  });
}

// --- Public API (unchanged signature) ---

/**
 * Restore a damaged photo using Qwen Image Edit 2511 Lightning model.
 *
 * - Without customPrompt: creates one project per restoration preset so each
 *   of the N results uses a different restoration philosophy.
 * - With customPrompt: creates a single project with N copies of that prompt
 *   (original chat/tool-calling behaviour).
 */
export async function restorePhoto(
  sogniClient: SogniClient,
  params: RestorationParams,
  onProgress?: (progress: RestorationProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  const {
    imageData,
    width,
    height,
    tokenType,
    customPrompt,
    outputFormat,
    numberOfMedia = 4,
    qualityTier = DEFAULT_QUALITY,
  } = params;

  const effectiveFormat = outputFormat || QUALITY_PRESETS[qualityTier].outputFormat;

  if (customPrompt) {
    // Chat / tool-calling flow — single prompt, N copies
    return restoreWithSinglePrompt(
      sogniClient,
      customPrompt,
      { imageData, width, height, tokenType, outputFormat: effectiveFormat, numberOfMedia, qualityTier, modelOverride: params.modelOverride },
      onProgress,
      signal,
      sessionId,
    );
  }

  // Default restoration — each slot gets a different preset prompt
  const presets = getPresetsForCount(numberOfMedia, params.restorationMode);
  return restoreWithPresets(
    sogniClient,
    presets,
    { imageData, width, height, tokenType, outputFormat: effectiveFormat, qualityTier },
    onProgress,
    signal,
    sessionId,
  );
}
