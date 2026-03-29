/**
 * Video generation service for image-to-video (I2V).
 * Supports multiple video models (WAN 2.2, LTX 2.3) via centralized config.
 * Supports multi-video batching via the photobooth pattern (numberOfMedia > 1).
 */
import { SogniClient } from '@sogni-ai/sogni-client';
import { TokenType } from '@/types/wallet';
import {
  DEFAULT_VIDEO_MODEL,
  getVideoModelConfig,
  calculateVideoDimensions,
  calculateVideoFrames,
  type VideoModelId,
} from '@/constants/videoSettings';
import { resizeImageToFit } from '@/utils/imageProcessing';
import { projectSessionMap } from '@/services/projectSessionMap';

export interface VideoGenerationParams {
  /** Start frame image data. Null when using end-frame-only mode. */
  imageData: Uint8Array | null;
  width: number;
  height: number;
  tokenType: TokenType;
  prompt: string;
  /** MIME type of imageData (default: 'image/jpeg') */
  imageMimeType?: string;
  /** Which video model to use (defaults to DEFAULT_VIDEO_MODEL) */
  videoModelId?: VideoModelId;
  /** Video duration in seconds (default: 5) */
  duration?: number;
  /** Number of videos to generate concurrently (default: 1) */
  numberOfMedia?: number;
  /** Target aspect ratio or exact dimensions (e.g. "16:9", "1920x1080") */
  aspectRatio?: string;
  /** Target shorter-side resolution (e.g. 768 for 720p, 1088 for 1080p) */
  targetResolution?: number;
  /** Whether to disable the NSFW safety filter */
  disableNSFWFilter?: boolean;
  /** Optional end frame image data for keyframe interpolation */
  endImageData?: Uint8Array;
  /** How strictly to match the first frame (0-1, default 0.6). Set to 0 to disable start frame. */
  firstFrameStrength?: number;
  /** How strictly to match the last frame (0-1, default 0.6). */
  lastFrameStrength?: number;
  /** Persona voice clip for LTX-2.3 referenceAudioIdentity */
  referenceAudioIdentity?: Blob | null;
}

export interface VideoGenerationProgress {
  type: 'started' | 'progress' | 'completed' | 'error' | 'jobETA';
  progress?: number;
  resultUrl?: string;
  error?: string;
  etaSeconds?: number;
  /** Index of the job in the batch (0-based) */
  jobIndex?: number;
  /** How many jobs have completed so far */
  completedCount?: number;
  /** Total number of jobs in this batch */
  totalCount?: number;
}

/**
 * Generate one or more videos from a source image.
 * Returns an array of video URLs on completion.
 */
export async function generateVideo(
  sogniClient: SogniClient,
  params: VideoGenerationParams,
  onProgress?: (progress: VideoGenerationProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  if (signal?.aborted) {
    throw new Error('CANCELLED');
  }

  const { imageData, width: srcWidth, height: srcHeight, tokenType, prompt } = params;
  const modelId = params.videoModelId ?? DEFAULT_VIDEO_MODEL;
  const duration = params.duration ?? 5;
  const numberOfMedia = params.numberOfMedia ?? 1;
  const config = getVideoModelConfig(modelId);

  const { width, height } = calculateVideoDimensions(srcWidth, srcHeight, params.targetResolution, modelId, params.aspectRatio);
  const frames = calculateVideoFrames(duration, modelId);

  console.log('[VIDEO SERVICE] Starting video generation...', {
    srcDimensions: imageData ? `${srcWidth}x${srcHeight}` : '(end-frame-only)',
    videoDimensions: `${width}x${height}`,
    frames,
    fps: config.fps,
    model: config.model,
    modelId,
    numberOfMedia,
    hasEndFrame: !!params.endImageData,
  });

  // Build project config — model-specific params applied dynamically
  const projectConfig: any = {
    type: 'video',
    modelId: config.model,
    positivePrompt: prompt,
    negativePrompt: '',
    stylePrompt: '',
    numberOfMedia,
    sizePreset: 'custom',
    width,
    height,
    frames,
    fps: config.fps,
    steps: config.steps,
    guidance: config.guidance,
    sampler: config.sampler,
    scheduler: config.scheduler,
    seed: -1,
    tokenType,
    disableNSFWFilter: !!params.disableNSFWFilter,
  };

  // Start frame (referenceImage) — only when imageData is provided
  if (imageData) {
    const resized = await resizeImageToFit(imageData, srcWidth, srcHeight, width, height, params.imageMimeType || 'image/jpeg');
    projectConfig.referenceImage = new Blob([new Uint8Array(resized.data)], { type: resized.mimeType });
  }

  // End frame for keyframe interpolation
  if (params.endImageData) {
    const resizedEnd = await resizeImageToFit(params.endImageData, srcWidth, srcHeight, width, height, params.imageMimeType || 'image/jpeg');
    projectConfig.referenceImageEnd = new Blob([new Uint8Array(resizedEnd.data)], { type: resizedEnd.mimeType });
  }

  // Frame strength controls
  if (params.firstFrameStrength !== undefined) {
    projectConfig.firstFrameStrength = params.firstFrameStrength;
  }
  if (params.lastFrameStrength !== undefined) {
    projectConfig.lastFrameStrength = params.lastFrameStrength;
  }

  // Persona voice clip for LTX-2.3 audio identity
  if (params.referenceAudioIdentity) {
    projectConfig.referenceAudioIdentity = params.referenceAudioIdentity;
    console.log('[VIDEO SERVICE] Injecting persona voice clip as referenceAudioIdentity');
  }

  // Model-specific params
  if (config.shift !== undefined) {
    projectConfig.shift = config.shift;
  }
  if (config.strength !== undefined) {
    projectConfig.strength = config.strength;
  }

  const startTime = Date.now();
  let project: any;

  try {
    project = await sogniClient.projects.create(projectConfig);
    if (sessionId) void projectSessionMap.register(project.id, sessionId);
    console.log(`[VIDEO SERVICE] Project created in ${Date.now() - startTime}ms: ${project.id}`);
  } catch (createError: any) {
    console.error('[VIDEO SERVICE] Failed to create project:', createError);
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
    onProgress({ type: 'started', totalCount: numberOfMedia });
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    const projectsApi = sogniClient.projects as any;

    // Pre-allocate result array (photobooth pattern)
    const resultUrls: (string | null)[] = new Array(numberOfMedia).fill(null);
    const jobMap = new Map<string, number>();
    const urlSet = new Set<string>();
    let failedCount = 0;
    let lastETA: number | undefined = undefined;

    // Activity-based inactivity timeout (reset on every progress/ETA event)
    const INACTIVITY_TIMEOUT_MS = 240_000; // 4 minutes of no activity
    const ACTIVITY_CHECK_INTERVAL_MS = 30_000; // check every 30s
    let lastActivityTime = Date.now();

    // Abort signal handling
    let onAbort: (() => void) | null = null;

    const cleanup = () => {
      if (projectsApi && typeof projectsApi.off === 'function') {
        projectsApi.off('job', globalJobHandler);
      }
      project.off('jobStarted', jobStartedHandler);
      project.off('jobCompleted', jobCompletedHandler);
      project.off('jobFailed', jobFailedHandler);
      (project as any).off?.('failed', projectFailedHandler);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      clearInterval(activityCheckId);
    };

    const finishResolve = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      const finalUrls = resultUrls.filter(u => u !== null) as string[];
      resolve(finalUrls);
    };

    const finishReject = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    if (signal) {
      onAbort = () => {
        console.log('[VIDEO SERVICE] Abort signal received, cancelling project...');
        try { project.cancel?.(); } catch (e) { console.warn('[VIDEO SERVICE] Error cancelling project:', e); }
        finishReject(new Error('CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Pre-seed jobMap from project.jobs if already populated
    if (project.jobs && project.jobs.length > 0) {
      project.jobs.forEach((job: any, index: number) => {
        jobMap.set(job.id, index);
      });
    }

    // Track new jobs dynamically (cap at numberOfMedia to ignore spurious SDK events)
    const jobStartedHandler = (job: any) => {
      if (!jobMap.has(job.id) && jobMap.size < numberOfMedia) {
        jobMap.set(job.id, jobMap.size);
      }
    };
    project.on('jobStarted', jobStartedHandler);

    // Shared handler for placing results at correct index
    const handledJobs = new Set<string>();
    const handleJobResult = (jobId: string, resultUrl: string | null) => {
      if (handledJobs.has(jobId)) return;
      handledJobs.add(jobId);
      const jobIndex = jobMap.get(jobId);
      if (jobIndex === undefined) return;

      if (resultUrl && !urlSet.has(resultUrl) && jobIndex >= 0 && jobIndex < resultUrls.length) {
        resultUrls[jobIndex] = resultUrl;
        urlSet.add(resultUrl);

        const completedCount = resultUrls.filter(u => u !== null).length;
        if (onProgress) {
          onProgress({
            type: 'completed',
            progress: 1,
            resultUrl,
            jobIndex,
            completedCount,
            totalCount: numberOfMedia,
          });
        }
      } else if (!resultUrl) {
        failedCount++;
        console.warn(`[VIDEO SERVICE] Job ${jobId} completed with no resultUrl`);
      }

      const completedCount = resultUrls.filter(u => u !== null).length;
      if (completedCount + failedCount >= numberOfMedia) {
        if (completedCount > 0) {
          console.log(`[VIDEO SERVICE] All jobs done. ${completedCount}/${numberOfMedia} succeeded.`);
          finishResolve();
        } else {
          finishReject(new Error('All video generation jobs failed'));
        }
      }
    };

    // Global job event handler for progress, ETA, and completion
    const globalJobHandler = (event: any) => {
      if (event.projectId !== project.id) return;

      // Track job IDs we haven't seen yet (cap at numberOfMedia)
      if (event.jobId && !jobMap.has(event.jobId) && jobMap.size < numberOfMedia) {
        jobMap.set(event.jobId, jobMap.size);
      }

      const jobIndex = jobMap.get(event.jobId);

      if (event.type === 'progress' && event.step !== undefined && event.stepCount !== undefined) {
        lastActivityTime = Date.now();
        const normalizedProgress = event.step / event.stepCount;
        if (onProgress) {
          onProgress({
            type: 'progress',
            progress: normalizedProgress,
            jobIndex,
            etaSeconds: lastETA,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount: numberOfMedia,
          });
        }
      }

      if (event.type === 'jobETA' && event.etaSeconds !== undefined) {
        lastActivityTime = Date.now();
        lastETA = event.etaSeconds;
        if (onProgress) {
          onProgress({
            type: 'jobETA',
            etaSeconds: event.etaSeconds,
            jobIndex,
            completedCount: resultUrls.filter(u => u !== null).length,
            totalCount: numberOfMedia,
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

    // Project-level job completion (backup)
    const jobCompletedHandler = (job: any) => {
      handleJobResult(job.id, job.resultUrl || null);
    };
    project.on('jobCompleted', jobCompletedHandler);

    // Job failure
    const jobFailedHandler = (job: any) => {
      console.error('[VIDEO SERVICE] Job failed:', job?.error);
      if (!resolved) {
        // Prevent double-counting if globalJobHandler also fires for this job
        if (job?.id) {
          if (handledJobs.has(job.id)) return;
          handledJobs.add(job.id);
        }

        const error = job?.error;
        const errorMsg = typeof error === 'string' ? error : (error?.message || 'Video generation failed');
        if (
          error?.code === 4024 ||
          errorMsg.toLowerCase().includes('insufficient')
        ) {
          const err = new Error('INSUFFICIENT_CREDITS') as any;
          err.code = error?.code;
          err.isInsufficientCredits = true;
          finishReject(err);
          return;
        }
        failedCount++;

        // Notify UI about the per-job failure so the overlay updates in real time
        const jobIndex = job?.id ? jobMap.get(job.id) : undefined;
        const completedCount = resultUrls.filter(u => u !== null).length;
        if (onProgress) {
          onProgress({
            type: 'error',
            error: errorMsg,
            jobIndex,
            completedCount,
            totalCount: numberOfMedia,
          });
        }

        if (completedCount + failedCount >= numberOfMedia) {
          if (completedCount > 0) {
            console.log(`[VIDEO SERVICE] Partial success: ${completedCount}/${numberOfMedia}`);
            finishResolve();
          } else {
            finishReject(new Error(errorMsg));
          }
        }
      }
    };
    project.on('jobFailed', jobFailedHandler);

    // Project failure
    const projectFailedHandler = (error: any) => {
      console.error('[VIDEO SERVICE] Project failed:', error);
      if (!resolved) {
        const errorMsg = typeof error === 'string' ? error : (error?.message || 'Video generation failed');
        finishReject(new Error(errorMsg));
      }
    };
    (project as any).on('failed', projectFailedHandler);

    // Inactivity-based timeout: check every 30s, timeout after 4 min of no activity
    const activityCheckId = setInterval(() => {
      if (resolved) return;
      const inactivitySec = (Date.now() - lastActivityTime) / 1000;
      if (inactivitySec > INACTIVITY_TIMEOUT_MS / 1000) {
        const finalUrls = resultUrls.filter(u => u !== null) as string[];
        if (finalUrls.length > 0) {
          console.warn(`[VIDEO SERVICE] No activity for ${inactivitySec.toFixed(0)}s, resolving with ${finalUrls.length}/${numberOfMedia} partial results`);
          finishResolve();
        } else {
          console.error(`[VIDEO SERVICE] Video generation timed out — no activity for ${inactivitySec.toFixed(0)}s (${numberOfMedia} video(s))`);
          finishReject(new Error('Video generation timed out'));
        }
      }
    }, ACTIVITY_CHECK_INTERVAL_MS);
  });
}
