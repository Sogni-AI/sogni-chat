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

  const audioModel = AUDIO_MODELS[modelKey];
  const steps = audioModel.steps.default;

  // Cost estimation & pre-flight
  const originalToken = context.tokenType;
  let estimatedCost = await fetchAudioCostEstimate(context.sogniClient, context.tokenType, audioModel.id, duration, steps);

  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchAudioCostEstimate(context.sogniClient, context.tokenType, audioModel.id, duration, steps);
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'generate_music',
    totalCount: 1,
    estimatedCost,
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
          tokenType,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.completed ? 'completed' : 'progress',
            toolName: 'generate_music',
            progress: progress.progress,
            completedCount: progress.completedCount,
            totalCount: 1,
            jobIndex: 0,
            etaSeconds: progress.etaSeconds,
            estimatedCost,
          });
        },
        context.signal,
      ),
      context,
      estimatedCost,
    );

    if (billingId) void recordCompletion(billingId);

    // Music results are passed as regular resultUrls (audio type)
    callbacks.onToolComplete('generate_music', audioUrls);

    return JSON.stringify({
      success: true,
      resultCount: audioUrls.length,
      mediaType: 'audio',
      model: audioModel.name,
      duration,
      bpm,
      keyscale,
      timesig,
      hasLyrics: !!lyrics,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${duration}-second ${lyrics ? 'song' : 'instrumental'} using ${audioModel.name} at ${bpm} BPM in ${keyscale}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now listen to the result.`,
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
  tokenType: TokenType;
}

interface MusicProgress {
  progress?: number;
  completedCount?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runMusicGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: MusicParams,
  onProgress: (progress: MusicProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const projectParams: Record<string, unknown> = {
    type: 'audio',
    modelId: params.modelId,
    positivePrompt: params.prompt,
    tokenType: params.tokenType,
    duration: params.duration,
    bpm: params.bpm,
    keyscale: params.keyscale,
    timesignature: params.timesig.toString(),
    steps: params.steps,
    shift: params.shift,
    seed: -1,
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

  return new Promise<string[]>((resolve, reject) => {
    const resultUrls: string[] = [];
    let completed = false;

    // Check if already aborted before setting up listeners
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    // Timeout: 10 minutes (music can generate up to 600-second tracks)
    const timeoutMs = 600_000;
    const timeoutId = setTimeout(() => {
      if (!completed) {
        cleanup();
        reject(new Error('Music generation timed out'));
      }
    }, timeoutMs);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Music generation aborted'));
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);
      projects.off('job', jobHandler);
      projects.off('project', projectHandler);
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Map jobId → jobIndex from initiating/started events (which include jobIndex)
    // Music is single-job, so fallback to 0 is safe
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
            onProgress({ progress: step / stepCount });
          }
          break;
        }
        case 'jobETA': {
          onProgress({ etaSeconds: event.etaSeconds as number | undefined });
          break;
        }
        case 'completed': {
          if (!event.jobId || completed) return;
          const resultUrl = event.resultUrl as string | undefined;
          if (resultUrl && !event.error) {
            resultUrls.push(resultUrl);
            completed = true;
            onProgress({ completed: true, completedCount: 1, resultUrl, progress: 1 });
            cleanup();
            resolve(resultUrls);
          } else {
            cleanup();
            reject(new Error(String(event.error || 'Music generation completed with no result')));
          }
          break;
        }
        case 'error':
        case 'failed': {
          cleanup();
          reject(new Error(String((event.error as { message?: string })?.message || event.error || 'Music generation failed')));
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
