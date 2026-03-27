/**
 * Handler for generate_music tool.
 * Based on workflow_text_to_music.mjs — ACE-Step text-to-music generation.
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
} from '../shared';
import type { TokenType } from '@/types/wallet';
import { AUDIO_MODELS } from '@/constants/audioSettings';
import { fetchAudioCostEstimate } from '@/services/creditsService';
import { saveAudioToGallery } from '@/services/galleryService';
import { projectSessionMap } from '@/services/projectSessionMap';

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const prompt = args.prompt as string;
  const modelKey = (args.model as string) === 'sft' ? 'sft' : 'turbo';
  const duration = Math.max(10, Math.min(600, (args.duration as number) || 30));
  const bpm = Math.max(30, Math.min(300, (args.bpm as number) || 120));
  const keyscale = (args.keyscale as string) || 'C major';
  const lyrics = args.lyrics as string | undefined;
  const timesig = ([2, 3, 4, 6].includes(args.timesig as number) ? args.timesig : 4) as number;
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));

  const audioModel = AUDIO_MODELS[modelKey];
  const steps = audioModel.steps.default;

  // Cost estimation & pre-flight
  const originalToken = context.tokenType;
  let estimatedCost = await fetchAudioCostEstimate(context.sogniClient, context.tokenType, audioModel.id, duration, steps, numberOfMedia);

  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchAudioCostEstimate(context.sogniClient, context.tokenType, audioModel.id, duration, steps, numberOfMedia);
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'generate_music',
    totalCount: numberOfMedia,
    estimatedCost,
    modelName: `${audioModel.name} — ${duration}s`,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('generate_music', estimatedCost, context.tokenType)
    : null;

  try {
    const audioUrls = await tryWithTokenFallback(
      (tokenType: TokenType) => runMusicGeneration(
        context.sogniClient,
        {
          modelId: audioModel.id,
          prompt,
          duration,
          bpm,
          keyscale,
          timesig,
          lyrics,
          steps,
          shift: audioModel.shift.default,
          guidance: audioModel.guidance?.default,
          numberOfMedia,
          tokenType,
          disableNSFWFilter: context.safeContentFilter === false,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.completed ? 'completed' : 'progress',
            toolName: 'generate_music',
            progress: progress.progress,
            completedCount: progress.completedCount,
            totalCount: numberOfMedia,
            jobIndex: progress.jobIndex,
            etaSeconds: progress.etaSeconds,
            estimatedCost,
          });
        },
        context.signal,
        context.sessionId,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);

    // Music results are passed as regular resultUrls (audio type)
    callbacks.onToolComplete('generate_music', audioUrls);

    // Save each audio track to gallery (fire-and-forget)
    for (const audioUrl of audioUrls) {
      saveAudioToGallery({
        audioUrl,
        prompt,
        duration,
        modelKey,
      }).then(({ galleryImageId }) => {
        callbacks.onGallerySaved?.([], [], [galleryImageId]);
      }).catch(err => {
        console.error('[MUSIC] Failed to save audio to gallery:', err);
      });
    }

    return JSON.stringify({
      success: true,
      resultCount: audioUrls.length,
      mediaType: 'audio',
      audioUrls,
      model: audioModel.name,
      duration,
      bpm,
      keyscale,
      timesig,
      hasLyrics: !!lyrics,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${audioUrls.length} ${duration}-second ${lyrics ? 'song' : 'instrumental'}${audioUrls.length !== 1 ? 's' : ''} using ${audioModel.name} at ${bpm} BPM in ${keyscale}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now listen to the result${audioUrls.length !== 1 ? 's' : ''}. The audio URL(s) can be used with sound_to_video to create a music video.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for music generation.' });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SDK project execution
// ---------------------------------------------------------------------------

interface MusicParams {
  modelId: string;
  prompt: string;
  duration: number;
  bpm: number;
  keyscale: string;
  timesig: number;
  lyrics?: string;
  steps: number;
  shift: number;
  guidance?: number;
  numberOfMedia: number;
  tokenType: TokenType;
  disableNSFWFilter?: boolean;
}

interface MusicProgress {
  progress?: number;
  completedCount?: number;
  jobIndex?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runMusicGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: MusicParams,
  onProgress: (progress: MusicProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  const projectParams: Record<string, unknown> = {
    type: 'audio',
    modelId: params.modelId,
    positivePrompt: params.prompt,
    numberOfMedia: params.numberOfMedia,
    tokenType: params.tokenType,
    duration: params.duration,
    bpm: params.bpm,
    keyscale: params.keyscale,
    timesignature: params.timesig.toString(),
    steps: params.steps,
    shift: params.shift,
    seed: -1,
    disableNSFWFilter: !!params.disableNSFWFilter,
  };

  if (params.lyrics) {
    projectParams.lyrics = params.lyrics;
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
  if (sessionId) void projectSessionMap.register(project.id, sessionId);

  return new Promise<string[]>((resolve, reject) => {
    // Pre-allocate slots so results land at their original jobIndex position
    // regardless of which job finishes first (dePIN network order varies).
    const resultUrls: (string | null)[] = new Array(params.numberOfMedia).fill(null);
    let completedCount = 0;
    let failedCount = 0;
    const totalJobs = params.numberOfMedia;

    // Check if already aborted before setting up listeners
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    // Activity-based inactivity timeout: reject if no progress/ETA for 10 min
    // (music tracks can be up to 600s, so use a longer inactivity window)
    let lastActivityTime = Date.now();
    const INACTIVITY_TIMEOUT_MS = 600_000; // 10 minutes
    const inactivityCheck = setInterval(() => {
      const idleMs = Date.now() - lastActivityTime;
      if (idleMs >= INACTIVITY_TIMEOUT_MS) {
        console.warn(`[MUSIC] No activity for ${(idleMs / 1000).toFixed(0)}s — timing out`);
        cleanup();
        if (resultUrls.some(url => url !== null)) {
          resolve(resultUrls.filter((url): url is string => url !== null));
        } else {
          reject(new Error('Music generation timed out (no activity)'));
        }
      }
    }, 30_000);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Music generation aborted'));
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
          reject(new Error(`All ${totalJobs} music generation jobs failed`));
        } else {
          resolve(resultUrls.filter((url): url is string => url !== null));
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
            const jobIndex = jobIdToIndex.get(event.jobId as string);
            if (jobIndex !== undefined && jobIndex >= 0 && jobIndex < resultUrls.length) {
              resultUrls[jobIndex] = resultUrl;
            } else {
              const emptySlot = resultUrls.indexOf(null);
              if (emptySlot !== -1) {
                resultUrls[emptySlot] = resultUrl;
              }
            }
            completedCount++;
            onProgress({ completed: completedCount >= totalJobs, completedCount, jobIndex: jobIdToIndex.get(event.jobId as string), resultUrl, progress: 1 });
          } else {
            failedCount++;
            console.error('[MUSIC] Job completed with error:', event.error);
          }
          checkDone();
          break;
        }
        case 'error':
        case 'failed': {
          failedCount++;
          console.error('[MUSIC] Job failed:', event.error);
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
