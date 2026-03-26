/**
 * Handler for edit_image tool.
 * Based on workflow_image_edit.mjs — multi-context image editing.
 *
 * Key difference from restore_photo: this supports contextImages for
 * reference-based generation with 1-6 images guiding the output.
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
  sanitizeBatchPrompt,
} from '../shared';
import type { TokenType } from '@/types/wallet';
import { parseAspectRatio } from '@/utils/imageDimensions';
import { fetchImageCostEstimate } from '@/services/creditsService';
import { projectSessionMap } from '@/services/projectSessionMap';

// ---------------------------------------------------------------------------
// Model configurations (from MODELS.imageEdit in workflow-helpers.mjs)
// ---------------------------------------------------------------------------

interface ImageEditModelConfig {
  id: string;
  name: string;
  maxWidth: number;
  maxHeight: number;
  defaultSteps: number;
  defaultGuidance?: number;
  maxContextImages: number;
  sampler: string;
  scheduler: string;
}

const IMAGE_EDIT_MODELS: Record<string, ImageEditModelConfig> = {
  'qwen-lightning': {
    id: 'qwen_image_edit_2511_fp8_lightning',
    name: 'Qwen Image Edit 2511 Lightning',
    maxWidth: 2560,
    maxHeight: 2560,
    defaultSteps: 4,
    defaultGuidance: 1.0,
    maxContextImages: 3,
    sampler: 'euler',
    scheduler: 'simple',
  },
  qwen: {
    id: 'qwen_image_edit_2511_fp8',
    name: 'Qwen Image Edit 2511',
    maxWidth: 2560,
    maxHeight: 2560,
    defaultSteps: 20,
    defaultGuidance: 4.0,
    maxContextImages: 3,
    sampler: 'euler',
    scheduler: 'simple',
  },
  flux2: {
    id: 'flux2_dev_fp8',
    name: 'Flux.2 Dev',
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 40,
    defaultGuidance: 4.0,
    maxContextImages: 6,
    sampler: 'euler',
    scheduler: 'simple',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapToMultipleOf16(value: number): number {
  return Math.round(value / 16) * 16;
}

interface ContextImageEntry {
  data: Uint8Array;
  mimeType: string;
}

function gatherContextImages(
  context: ToolExecutionContext,
  sourceImageIndex: number | undefined,
): ContextImageEntry[] {
  const entries: ContextImageEntry[] = [];
  const seen = new Set<Uint8Array>();

  // If a primary image is specified by index, use it first
  if (sourceImageIndex !== undefined && sourceImageIndex >= 0) {
    const imageFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'image');
    if (sourceImageIndex < imageFiles.length) {
      const file = imageFiles[sourceImageIndex];
      entries.push({ data: file.data, mimeType: file.mimeType });
      seen.add(file.data);
    }
  }

  // Add the main uploaded image as context if available and not already added
  if (context.imageData && entries.length === 0) {
    // Infer MIME from the first image upload, fall back to jpeg
    const firstImage = context.uploadedFiles.find((f: UploadedFile) => f.type === 'image');
    entries.push({ data: context.imageData, mimeType: firstImage?.mimeType ?? 'image/jpeg' });
    seen.add(context.imageData);
  }

  // Add any additional uploaded images as context
  const imageFiles = context.uploadedFiles.filter((f: UploadedFile) => f.type === 'image');
  for (const file of imageFiles) {
    // Avoid duplicates — simple reference check
    if (!seen.has(file.data)) {
      entries.push({ data: file.data, mimeType: file.mimeType });
      seen.add(file.data);
    }
  }

  return entries;
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
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const sourceImageIndex = args.sourceImageIndex as number | undefined;
  const aspectRatio = args.aspectRatio as string | undefined;

  // Gather context images from uploads
  const contextImages = gatherContextImages(context, sourceImageIndex);
  if (contextImages.length === 0) {
    return JSON.stringify({ error: 'no_images', message: 'Please upload at least one image to use as a reference.' });
  }

  // Detect persona reference photos in context (injected by resolve_personas)
  const personaFiles = context.uploadedFiles.filter(
    f => f.type === 'image' && f.filename?.startsWith('persona-'),
  );
  const hasPersonaPhotos = personaFiles.length > 0;

  const defaultModel = context.qualityTier === 'pro' ? 'flux2'
    : context.qualityTier === 'hq' ? 'qwen' : 'qwen-lightning';
  const explicitModel = args.model as string | undefined;
  // Honor explicit model if provided (from user retry menu or LLM), otherwise use quality tier default.
  const modelKey = explicitModel || defaultModel;
  const modelConfig = IMAGE_EDIT_MODELS[modelKey] ?? IMAGE_EDIT_MODELS['qwen-lightning'];

  // Cap to model max
  const cappedContextImages = contextImages.slice(0, modelConfig.maxContextImages);

  // Compute output dimensions
  let outputWidth = (args.width as number) || context.width || 1024;
  let outputHeight = (args.height as number) || context.height || 1024;

  const parsed = parseAspectRatio(aspectRatio);
  if (parsed?.type === 'exact') {
    outputWidth = parsed.width;
    outputHeight = parsed.height;
  } else if (parsed?.type === 'ratio') {
    const area = outputWidth * outputHeight;
    const ratio = parsed.ratioW / parsed.ratioH;
    outputWidth = Math.sqrt(area * ratio);
    outputHeight = area / outputWidth;
  }

  outputWidth = snapToMultipleOf16(outputWidth);
  outputHeight = snapToMultipleOf16(outputHeight);
  outputWidth = Math.max(16, Math.min(modelConfig.maxWidth, outputWidth));
  outputHeight = Math.max(16, Math.min(modelConfig.maxHeight, outputHeight));

  const steps = modelConfig.defaultSteps;

  // Cost estimation & pre-flight
  const originalToken = context.tokenType;
  let estimatedCost = await fetchImageCostEstimate(context.sogniClient, context.tokenType, modelConfig.id, numberOfMedia, steps, modelConfig.defaultGuidance, modelConfig.sampler, cappedContextImages.length);

  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchImageCostEstimate(context.sogniClient, context.tokenType, modelConfig.id, numberOfMedia, steps, modelConfig.defaultGuidance, modelConfig.sampler, cappedContextImages.length);
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'edit_image',
    totalCount: numberOfMedia,
    estimatedCost,
    modelName: `${modelConfig.name} — ${outputWidth}x${outputHeight}`,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('edit_image', estimatedCost, context.tokenType)
    : null;

  // If persona reference photos are in context but the LLM's prompt doesn't
  // reference them by picture number, the model will ignore them.
  // Auto-enhance: prepend light identity anchors, keep creative direction last
  // so the model prioritizes the transformation over raw preservation.
  let effectivePrompt = prompt;
  if (hasPersonaPhotos && !prompt.toLowerCase().includes('picture')) {
    // Build brief picture anchors — just enough for the model to bind identity
    const personaAnchors = personaFiles.map((f) => {
      const personaName = f.filename?.replace('persona-', '').replace('.jpg', '').replace(/-/g, ' ') || 'person';
      const pictureIdx = cappedContextImages.findIndex(ci => ci.data === f.data) + 1;
      if (pictureIdx > 0) {
        return `Use the face from picture ${pictureIdx} (${personaName})`;
      }
      return null;
    }).filter(Boolean);
    if (personaAnchors.length > 0) {
      // Identity anchors first, creative direction last — last instruction wins
      effectivePrompt = `${personaAnchors.join('. ')}. ${prompt}`;
      console.log('[EDIT IMAGE] Enhanced prompt with persona identity anchors (creative-last)');
    }
  }

  // Strip grid/collage-causing language for batch variations
  if (numberOfMedia > 1) {
    const before = effectivePrompt;
    effectivePrompt = sanitizeBatchPrompt(effectivePrompt);
    if (effectivePrompt !== before) {
      console.log('[EDIT IMAGE] Sanitized batch prompt to prevent grid output');
    }
  }

  console.log(`[EDIT IMAGE] Context: ${cappedContextImages.length} images (${hasPersonaPhotos ? personaFiles.length + ' persona' : 'no persona'}), model: ${modelConfig.id}, steps: ${modelConfig.defaultSteps}, guidance: ${modelConfig.defaultGuidance}`);
  console.log(`[EDIT IMAGE] Prompt: ${effectivePrompt.slice(0, 300)}...`);

  try {
    const resultUrls = await tryWithTokenFallback(
      (tokenType: TokenType) => runEditGeneration(
        context.sogniClient,
        {
          modelId: modelConfig.id,
          prompt: effectivePrompt,
          contextImages: cappedContextImages,
          width: outputWidth,
          height: outputHeight,
          steps,
          guidance: modelConfig.defaultGuidance,
          numberOfMedia,
          tokenType,
          sampler: modelConfig.sampler,
          scheduler: modelConfig.scheduler,
          disableNSFWFilter: context.safeContentFilter === false,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.completed ? 'completed' : 'progress',
            toolName: 'edit_image',
            progress: progress.progress,
            completedCount: progress.completedCount,
            totalCount: numberOfMedia,
            jobIndex: progress.jobIndex,
            etaSeconds: progress.etaSeconds,
            resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
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
    callbacks.onToolComplete('edit_image', resultUrls);

    const personaNote = hasPersonaPhotos
      ? ' IMPORTANT: Compare the generated result against the persona reference photos. Be HONEST — if the faces, hair, or features do not match the reference photos, say so clearly and offer to retry. Do NOT claim the result looks like the person if it does not. The user can see the image too.'
      : '';

    return JSON.stringify({
      success: true,
      resultCount: resultUrls.length,
      model: modelConfig.name,
      contextImageCount: cappedContextImages.length,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${resultUrls.length} image${resultUrls.length !== 1 ? 's' : ''} using ${modelConfig.name} with ${cappedContextImages.length} reference image${cappedContextImages.length !== 1 ? 's' : ''}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see the results.${personaNote}`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for image editing.' });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SDK project execution
// ---------------------------------------------------------------------------

interface EditGenParams {
  modelId: string;
  prompt: string;
  contextImages: ContextImageEntry[];
  width: number;
  height: number;
  steps: number;
  guidance?: number;
  numberOfMedia: number;
  tokenType: TokenType;
  sampler: string;
  scheduler: string;
  disableNSFWFilter?: boolean;
}

interface EditProgress {
  progress?: number;
  completedCount?: number;
  jobIndex?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runEditGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: EditGenParams,
  onProgress: (progress: EditProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  const projectParams: Record<string, unknown> = {
    type: 'image',
    modelId: params.modelId,
    positivePrompt: params.prompt,
    numberOfMedia: params.numberOfMedia,
    steps: params.steps,
    seed: -1,
    contextImages: params.contextImages.map(e => new Blob([e.data as BlobPart], { type: e.mimeType })),
    tokenType: params.tokenType,
    sizePreset: 'custom',
    width: params.width,
    height: params.height,
    sampler: params.sampler,
    scheduler: params.scheduler,
    disableNSFWFilter: !!params.disableNSFWFilter,
    outputFormat: 'jpg',
  };

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

    // Safety timeout: 5 minutes
    const safetyTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Image editing timed out'));
    }, 300_000);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Image editing aborted'));
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
          reject(new Error(`All ${totalJobs} edit jobs failed`));
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
            console.error('[EDIT IMAGE] Job completed with error:', event.error);
          }
          checkDone();
          break;
        }
        case 'error':
        case 'failed': {
          failedCount++;
          console.error('[EDIT IMAGE] Job failed:', event.error);
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
