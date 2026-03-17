/**
 * Handler for generate_image tool.
 * Based on workflow_text_to_image.mjs — creates images from text prompts
 * using sogniClient.projects.create() directly.
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
  fetchImageAsUint8Array,
} from '../shared';
import type { TokenType } from '@/types/wallet';
import { parseAspectRatio } from '@/utils/imageDimensions';
import { fetchImageCostEstimate } from '@/services/creditsService';
import { projectSessionMap } from '@/services/projectSessionMap';

// ---------------------------------------------------------------------------
// Model configurations (from MODELS.image in workflow-helpers.mjs)
// ---------------------------------------------------------------------------

interface ImageModelConfig {
  id: string;
  name: string;
  defaultWidth: number;
  defaultHeight: number;
  maxWidth: number;
  maxHeight: number;
  defaultSteps: number;
  defaultGuidance?: number;
  sampler: string;
  scheduler: string;
  supportsImg2Img: boolean;
}

const IMAGE_MODELS: Record<string, ImageModelConfig> = {
  'z-turbo': {
    id: 'z_image_turbo_bf16',
    name: 'Z-Image Turbo',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 8,
    defaultGuidance: 1.0,
    sampler: 'res_multistep',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  'z-image': {
    id: 'z_image_bf16',
    name: 'Z-Image',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 30,
    defaultGuidance: 3.5,
    sampler: 'res_multistep',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  'chroma-v46-flash': {
    id: 'chroma-v.46-flash_fp8',
    name: 'Chroma v.46 Flash',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 10,
    defaultGuidance: 1.0,
    sampler: 'euler',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  'chroma-detail': {
    id: 'chroma-v48-detail-svd_fp8',
    name: 'Chroma Detail',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 30,
    defaultGuidance: 3.0,
    sampler: 'euler',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  'flux1-krea': {
    id: 'flux1-krea-dev_fp8_scaled',
    name: 'Flux.1 Krea',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 25,
    defaultGuidance: 3.5,
    sampler: 'euler',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  flux2: {
    id: 'flux2_dev_fp8',
    name: 'Flux.2 Dev',
    defaultWidth: 1248,
    defaultHeight: 832,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 4.0,
    sampler: 'euler',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  'pony-v7': {
    id: 'coreml-cyberrealisticPony_v7',
    name: 'CyberRealistic Pony v7',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'albedo-xl': {
    id: 'coreml-albedobaseXL_v31Large',
    name: 'AlbedoBase XL v3.1-Large',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'animagine-xl': {
    id: 'coreml-animagineXL40_v4Opt',
    name: 'Animagine XL 4.0',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'anima-pencil-xl': {
    id: 'coreml-animaPencilXL_v500',
    name: 'Anima Pencil XL v5',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'art-universe-xl': {
    id: 'coreml-artUniverse_sdxlV60',
    name: 'Art Universe XL v6',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'hyphoria-real': {
    id: 'coreml-hyphoriaRealIllu_v05',
    name: 'Hyphoria Real [Illu] v0.5',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'analog-madness-xl': {
    id: 'coreml-analogMadnessSDXL_xl2',
    name: 'Analog Madness SDXL v2',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'cyberrealistic-xl': {
    id: 'coreml-cyberrealisticXL_v60',
    name: 'CyberRealistic XL v6',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'real-dream-xl': {
    id: 'coreml-realDream_sdxlPony11',
    name: 'Real Dream XL-Pony-11',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'faetastic-xl': {
    id: 'coreml-sdxlFaetastic_v24',
    name: 'FaeTastic Details XL v24',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'zavychroma-xl': {
    id: 'coreml-zavychromaxl_v80',
    name: 'ZavyChromaXL v8',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'pony-faetality': {
    id: 'coreml-ponyFaetality_v11',
    name: 'Pony FaeTality v1.1',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'dreamshaper-xl': {
    id: 'coreml-DreamShaper-XL1-Alpha2',
    name: 'DreamShaper XL',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 7.0,
    sampler: 'dpm_pp',
    scheduler: 'karras',
    supportsImg2Img: true,
  },
  'qwen-2512': {
    id: 'qwen_image_2512_fp8',
    name: 'Qwen Image 2512',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 20,
    defaultGuidance: 4.0,
    sampler: 'euler',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
  'qwen-2512-lightning': {
    id: 'qwen_image_2512_fp8_lightning',
    name: 'Qwen Image 2512 Lightning',
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxWidth: 2048,
    maxHeight: 2048,
    defaultSteps: 4,
    defaultGuidance: 1.0,
    sampler: 'euler',
    scheduler: 'simple',
    supportsImg2Img: true,
  },
};

// ---------------------------------------------------------------------------
// Dimension helpers
// ---------------------------------------------------------------------------

function snapToMultipleOf16(value: number): number {
  return Math.round(value / 16) * 16;
}

function computeDimensions(
  requestedWidth: number | undefined,
  requestedHeight: number | undefined,
  aspectRatio: string | undefined,
  config: ImageModelConfig,
): { width: number; height: number } {
  let w = requestedWidth ?? config.defaultWidth;
  let h = requestedHeight ?? config.defaultHeight;

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

  w = snapToMultipleOf16(w);
  h = snapToMultipleOf16(h);
  w = Math.max(16, Math.min(config.maxWidth, w));
  h = Math.max(16, Math.min(config.maxHeight, h));

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
  const defaultModel = context.qualityTier === 'hq' ? 'z-image' : 'z-turbo';
  const explicitModel = args.model as string | undefined;
  // Only honor explicit model for specialized (non-tier) models like chroma/flux/pony.
  // Ignore z-turbo/z-image from args — those are handled by qualityTier.
  const TIER_DEFAULTS = ['z-turbo', 'z-image'];
  const modelKey = (explicitModel && !TIER_DEFAULTS.includes(explicitModel))
    ? explicitModel
    : defaultModel;
  const numberOfMedia = Math.max(1, Math.min(16, (args.numberOfVariations as number) || 1));
  const negativePrompt = args.negativePrompt as string | undefined;
  const aspectRatio = args.aspectRatio as string | undefined;
  const startingImageStrength = args.starting_image_strength as number | undefined;
  const rawSourceIndex = args.sourceImageIndex as number | undefined;
  const seedArg = args.seed as number | undefined;
  const guidanceArg = args.guidance as number | undefined;

  const modelConfig = IMAGE_MODELS[modelKey] ?? IMAGE_MODELS['z-turbo'];
  const { width, height } = computeDimensions(
    args.width as number | undefined,
    args.height as number | undefined,
    aspectRatio,
    modelConfig,
  );

  const steps = modelConfig.defaultSteps;
  const guidance = guidanceArg ?? modelConfig.defaultGuidance;
  const seed = seedArg ?? -1;

  // Resolve starting image for img2img
  let startingImageData: Uint8Array | undefined;
  let startingImageMime = 'image/jpeg';
  if (startingImageStrength !== undefined && startingImageStrength > 0 && modelConfig.supportsImg2Img) {
    const useOriginal = rawSourceIndex === -1;
    const effectiveSourceIndex = useOriginal
      ? undefined
      : rawSourceIndex ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

    if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
      try {
        console.log(`[GENERATE IMAGE] Using result image #${effectiveSourceIndex} as starting image`);
        const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
        startingImageData = fetched.data;
        startingImageMime = fetched.mimeType;
      } catch (err) {
        console.error('[GENERATE IMAGE] Failed to fetch starting image from results, trying original:', err);
      }
    }
    if (!startingImageData && context.imageData) {
      console.log('[GENERATE IMAGE] Using original uploaded image as starting image');
      startingImageData = context.imageData;
      const firstImage = context.uploadedFiles.find(f => f.type === 'image');
      startingImageMime = firstImage?.mimeType ?? 'image/jpeg';
    }
  }

  // Cost estimation & pre-flight
  const originalToken = context.tokenType;
  let estimatedCost: number;
  try {
    estimatedCost = await fetchImageCostEstimate(context.sogniClient, context.tokenType, modelConfig.id, numberOfMedia, steps, guidance, modelConfig.sampler);
  } catch (costErr) {
    console.error(`[GENERATE IMAGE] Cost estimation failed for model "${modelConfig.id}":`, costErr);
    return JSON.stringify({
      error: 'model_unavailable',
      message: `Model "${modelConfig.name}" (${modelConfig.id}) is not currently available. Try a different model such as "z-turbo", "chroma-v46-flash", or "flux2".`,
    });
  }

  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;
  if (context.tokenType !== originalToken) {
    estimatedCost = await fetchImageCostEstimate(context.sogniClient, context.tokenType, modelConfig.id, numberOfMedia, steps, guidance, modelConfig.sampler);
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'generate_image',
    totalCount: numberOfMedia,
    estimatedCost,
    modelName: `${modelConfig.name} — ${width}x${height}`,
  });

  const billingId = estimatedCost > 0
    ? registerPendingCost('generate_image', estimatedCost, context.tokenType)
    : null;

  try {
    const resultUrls = await tryWithTokenFallback(
      (tokenType: TokenType) => runImageGeneration(
        context.sogniClient,
        {
          modelId: modelConfig.id,
          prompt,
          negativePrompt,
          width,
          height,
          steps,
          guidance,
          numberOfMedia,
          tokenType,
          sampler: modelConfig.sampler,
          scheduler: modelConfig.scheduler,
          seed,
          startingImage: startingImageData,
          startingImageMime,
          startingImageStrength: startingImageStrength,
          disableNSFWFilter: context.safeContentFilter === false,
        },
        (progress) => {
          callbacks.onToolProgress({
            type: progress.completed ? 'completed' : 'progress',
            toolName: 'generate_image',
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
    callbacks.onToolComplete('generate_image', resultUrls);

    return JSON.stringify({
      success: true,
      resultCount: resultUrls.length,
      model: modelConfig.name,
      creditsCost: formatCredits(estimatedCost),
      message: `Successfully generated ${resultUrls.length} image${resultUrls.length !== 1 ? 's' : ''} using ${modelConfig.name}. Cost: ~${formatCredits(estimatedCost)} credits. The user can now see the results.`,
    });
  } catch (err: unknown) {
    if (billingId) discardPending(billingId);
    if (isInsufficientCreditsError(err)) {
      return JSON.stringify({ error: 'insufficient_credits', message: 'The user does not have enough credits for image generation.' });
    }
    if (err instanceof Error && (err as Error & { isNSFW?: boolean }).isNSFW) {
      return JSON.stringify({
        error: 'nsfw_filtered',
        message: 'The generated image was blocked by the Safe Content Filter. Ask the user if they would like to disable it. If they agree, call set_content_filter with enabled=false, then retry the image generation.',
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SDK project execution
// ---------------------------------------------------------------------------

interface ImageGenParams {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  guidance?: number;
  numberOfMedia: number;
  tokenType: TokenType;
  sampler: string;
  scheduler: string;
  seed?: number;
  startingImage?: Uint8Array;
  startingImageMime?: string;
  startingImageStrength?: number;
  disableNSFWFilter?: boolean;
}

interface ImageProgress {
  progress?: number;
  completedCount?: number;
  jobIndex?: number;
  etaSeconds?: number;
  resultUrl?: string;
  completed?: boolean;
}

async function runImageGeneration(
  sogniClient: ToolExecutionContext['sogniClient'],
  params: ImageGenParams,
  onProgress: (progress: ImageProgress) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<string[]> {
  const projectParams: Record<string, unknown> = {
    type: 'image',
    modelId: params.modelId,
    positivePrompt: params.prompt,
    numberOfMedia: params.numberOfMedia,
    steps: params.steps,
    seed: params.seed ?? -1,
    tokenType: params.tokenType,
    sizePreset: 'custom',
    width: params.width,
    height: params.height,
    sampler: params.sampler,
    scheduler: params.scheduler,
    disableNSFWFilter: !!params.disableNSFWFilter,
  };

  if (params.negativePrompt) {
    projectParams.negativePrompt = params.negativePrompt;
  }
  if (params.guidance !== undefined) {
    projectParams.guidance = params.guidance;
  }
  if (params.startingImage && params.startingImageStrength !== undefined) {
    projectParams.startingImage = new Blob([params.startingImage as BlobPart], { type: params.startingImageMime || 'image/jpeg' });
    projectParams.startingImageStrength = params.startingImageStrength;
  }

  const project = await (sogniClient as unknown as { projects: { create: (p: Record<string, unknown>) => Promise<{ id: string }>; on: (e: string, h: (ev: Record<string, unknown>) => void) => void; off: (e: string, h: (ev: Record<string, unknown>) => void) => void } }).projects.create(projectParams);
  if (sessionId) void projectSessionMap.register((project as { id: string }).id, sessionId);

  return new Promise<string[]>((resolve, reject) => {
    const resultUrls: string[] = [];
    let completedCount = 0;
    let failedCount = 0;
    let nsfwCount = 0;
    let lastFailReason = '';
    const totalJobs = params.numberOfMedia;
    // Check if already aborted before setting up listeners
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    // Safety timeout: 5 minutes
    const safetyTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Image generation timed out'));
    }, 300_000);

    const abortHandler = () => {
      cleanup();
      reject(new Error('Image generation aborted'));
    };

    const cleanup = () => {
      clearTimeout(safetyTimeout);
      signal?.removeEventListener('abort', abortHandler);
      (sogniClient as unknown as { projects: { off: (e: string, h: (ev: Record<string, unknown>) => void) => void } }).projects.off('job', jobHandler);
      (sogniClient as unknown as { projects: { off: (e: string, h: (ev: Record<string, unknown>) => void) => void } }).projects.off('project', projectHandler);
    };

    const checkDone = () => {
      if (completedCount + failedCount >= totalJobs) {
        cleanup();
        if (failedCount === totalJobs) {
          if (nsfwCount > 0) {
            reject(Object.assign(
              new Error(`Image was blocked by the Safe Content Filter. Ask the user if they would like to disable it, then call set_content_filter with enabled=false and retry.`),
              { isNSFW: true },
            ));
          } else {
            const detail = lastFailReason ? ` (${lastFailReason})` : '';
            reject(new Error(`All ${totalJobs} image generation job(s) failed for model "${params.modelId}"${detail}. The model may be temporarily unavailable — try a different model.`));
          }
        } else {
          resolve(resultUrls.filter(Boolean));
        }
      }
    };

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Map jobId → jobIndex from initiating/started events (which include jobIndex)
    const jobIdToIndex = new Map<string, number>();

    const jobHandler = (event: Record<string, unknown>) => {
      if ((event as { projectId?: string }).projectId !== (project as { id: string }).id) return;

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
            onProgress({
              progress: step / stepCount,
              jobIndex: event.jobId ? jobIdToIndex.get(event.jobId as string) : undefined,
            });
          }
          break;
        }
        case 'jobETA': {
          onProgress({
            etaSeconds: event.etaSeconds as number | undefined,
            jobIndex: event.jobId ? jobIdToIndex.get(event.jobId as string) : undefined,
          });
          break;
        }
        case 'completed': {
          if (!event.jobId) return;
          const resultUrl = event.resultUrl as string | undefined;
          const isNSFW = !!(event.isNSFW);
          if (resultUrl && !event.error && !isNSFW) {
            resultUrls.push(resultUrl);
            completedCount++;
            onProgress({
              completed: completedCount >= totalJobs,
              completedCount,
              jobIndex: jobIdToIndex.get(event.jobId as string),
              resultUrl,
              progress: 1,
            });
          } else if (isNSFW) {
            failedCount++;
            nsfwCount++;
            console.warn('[GENERATE IMAGE] Job blocked by Safe Content Filter');
            lastFailReason = 'nsfw_filtered';
          } else {
            failedCount++;
            const reason = event.error ?? (resultUrl ? 'unknown error' : 'no result URL returned');
            console.error('[GENERATE IMAGE] Job completed with error:', reason, '| event:', JSON.stringify(event));
            lastFailReason = String(reason);
          }
          checkDone();
          break;
        }
        case 'error':
        case 'failed': {
          failedCount++;
          const errObj = event.error as { originalCode?: string; message?: string } | string | undefined;
          const isSensitive = typeof errObj === 'object' && errObj?.originalCode === 'sensitiveContent'
            || (typeof errObj === 'object' && typeof errObj?.message === 'string' && errObj.message.toLowerCase().includes('sensitive content'))
            || (typeof errObj === 'string' && errObj.toLowerCase().includes('sensitive content'));
          if (isSensitive) {
            nsfwCount++;
            console.warn('[GENERATE IMAGE] Job blocked by Safe Content Filter (error event)');
            lastFailReason = 'nsfw_filtered';
          } else {
            const reason = errObj ?? 'unknown error';
            console.error('[GENERATE IMAGE] Job failed:', reason, '| event:', JSON.stringify(event));
            lastFailReason = String(typeof reason === 'object' ? (reason as { message?: string }).message || JSON.stringify(reason) : reason);
          }
          checkDone();
          break;
        }
      }
    };

    const projectHandler = (event: Record<string, unknown>) => {
      if ((event as { projectId?: string }).projectId !== (project as { id: string }).id) return;
      if (event.type === 'error' || event.type === 'failed') {
        cleanup();
        reject(new Error(String((event.error as { message?: string })?.message || event.error || 'Project failed')));
      }
    };

    (sogniClient as unknown as { projects: { on: (e: string, h: (ev: Record<string, unknown>) => void) => void } }).projects.on('job', jobHandler);
    (sogniClient as unknown as { projects: { on: (e: string, h: (ev: Record<string, unknown>) => void) => void } }).projects.on('project', projectHandler);
  });
}
