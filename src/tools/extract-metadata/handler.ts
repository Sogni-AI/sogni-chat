import type { ToolExecutionContext, ToolCallbacks } from '../types';

const METADATA_API_URL = 'https://metadata.sogni.ai/api/inspect';

/** Fields we extract from sogniDetails (ComfyUI-parsed metadata) */
interface GenerationParams {
  positivePrompt?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  loras?: Array<{ name: string; strength: number | null }>;
}

/** Safely parse a string to integer, returning undefined on failure (preserves 0) */
function safeInt(value: string): number | undefined {
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

/** Safely parse a string to float, returning undefined on failure (preserves 0) */
function safeFloat(value: string): number | undefined {
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

/** Parse a duration string like "4.230s" or "N/A" into a number or null */
function parseDuration(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value === 'N/A') return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

/** Curate sogniDetails into our generation params schema */
function curateFromSogniDetails(details: Record<string, unknown>): GenerationParams {
  const gen: GenerationParams = {};
  if (typeof details.positivePrompt === 'string') gen.positivePrompt = details.positivePrompt;
  if (typeof details.negativePrompt === 'string') gen.negativePrompt = details.negativePrompt;
  if (typeof details.model === 'string') gen.model = details.model;
  if (typeof details.width === 'number') gen.width = details.width;
  if (typeof details.height === 'number') gen.height = details.height;
  if (typeof details.steps === 'number') gen.steps = details.steps;
  if (typeof details.seed === 'number') gen.seed = details.seed;
  if (typeof details.cfg === 'number') gen.cfg = details.cfg;
  if (typeof details.sampler === 'string') gen.sampler = details.sampler;
  if (typeof details.scheduler === 'string') gen.scheduler = details.scheduler;
  if (typeof details.denoise === 'number') gen.denoise = details.denoise;
  if (Array.isArray(details.loras)) {
    gen.loras = details.loras.filter(
      (l): l is { name: string; strength: number | null } =>
        typeof l === 'object' && l !== null && typeof l.name === 'string',
    );
  }
  return gen;
}

/** Curate A1111-format generationParams into our schema */
function curateFromA1111(params: Record<string, unknown>): GenerationParams {
  const gen: GenerationParams = {};
  if (typeof params.positivePrompt === 'string') gen.positivePrompt = params.positivePrompt;
  if (typeof params.negativePrompt === 'string') gen.negativePrompt = params.negativePrompt;
  if (typeof params.Model === 'string') gen.model = params.Model;
  if (typeof params.Steps === 'string') gen.steps = safeInt(params.Steps);
  if (typeof params.Seed === 'string') gen.seed = safeInt(params.Seed);
  if (typeof params['CFG scale'] === 'string') gen.cfg = safeFloat(params['CFG scale']);
  if (typeof params.Sampler === 'string') gen.sampler = params.Sampler;
  if (typeof params['Schedule type'] === 'string') gen.scheduler = params['Schedule type'];
  if (typeof params['Denoising strength'] === 'string') gen.denoise = safeFloat(params['Denoising strength']);
  if (typeof params.Size === 'string') {
    const [w, h] = params.Size.split('x').map(Number);
    if (w && h) { gen.width = w; gen.height = h; }
  }
  return gen;
}

/** Check if generation params object has any meaningful data */
function hasGenerationData(gen: GenerationParams): boolean {
  return Object.values(gen).some(v => v !== undefined);
}

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  // Resolve file index (clamp to 0)
  const fileIndex = typeof args.file_index === 'number' ? Math.max(0, Math.floor(args.file_index)) : 0;

  if (!context.uploadedFiles || context.uploadedFiles.length === 0) {
    return JSON.stringify({ error: 'no_file', message: 'Please upload a file first.' });
  }

  const file = context.uploadedFiles[fileIndex] ?? context.uploadedFiles[0];
  const usedFallback = !context.uploadedFiles[fileIndex];

  console.log(`[METADATA] Inspecting file: ${file.filename} (${file.mimeType}, index=${fileIndex}${usedFallback ? ', fell back to 0' : ''})`);

  // Signal UI that extraction has started
  callbacks.onToolProgress({
    type: 'started',
    toolName: 'extract_metadata',
    totalCount: 1,
    stepLabel: 'Extracting metadata...',
  });

  // Build FormData with file blob
  const formData = new FormData();
  const blob = new Blob([file.data as BlobPart], { type: file.mimeType });
  formData.append('file', blob, file.filename);

  // POST to metadata service
  let responseData: Record<string, unknown>;
  try {
    const response = await fetch(METADATA_API_URL, {
      method: 'POST',
      body: formData,
      signal: context.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => null) as Record<string, unknown> | null;
      const message = errBody?.error ?? `HTTP ${response.status} ${response.statusText}`;
      console.error(`[METADATA] Service error: ${message}`);
      return JSON.stringify({ error: 'inspection_failed', message: String(message) });
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      console.error('[METADATA] Failed to parse response JSON');
      return JSON.stringify({ error: 'parse_error', message: 'Failed to parse metadata service response.' });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('[METADATA] Unexpected response shape');
      return JSON.stringify({ error: 'parse_error', message: 'Failed to parse metadata service response.' });
    }

    responseData = parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err; // Let the registry handle abort/timeout
    }
    console.error('[METADATA] Network error:', err);
    return JSON.stringify({ error: 'service_unavailable', message: 'Could not reach the metadata service.' });
  }

  console.log('[METADATA] Response received, curating fields');

  // Extract file info
  const fileSection = responseData.file as Record<string, unknown> | null;
  const fileInfo: Record<string, unknown> = {
    format: fileSection?.detectedFormat ?? null,
    width: null,
    height: null,
    duration: null,
  };

  // Dimensions from image or video
  const image = responseData.image as Record<string, unknown> | null;
  const video = responseData.video as Record<string, unknown> | null;
  if (image) {
    fileInfo.width = image.width ?? null;
    fileInfo.height = image.height ?? null;
  } else if (video) {
    const stream = video.stream as Record<string, unknown> | null;
    if (stream) {
      fileInfo.width = stream.width ?? null;
      fileInfo.height = stream.height ?? null;
    }
    const container = video.container as Record<string, unknown> | null;
    if (container) {
      // Prefer durationRaw (numeric) over duration (formatted string like "4.230s")
      fileInfo.duration = parseDuration(container.durationRaw ?? container.duration);
    }
  }

  // Animation duration (GIF/APNG — formatted as "2.50s" or similar)
  const animation = responseData.animation as Record<string, unknown> | null;
  if (animation && fileInfo.duration === null) {
    fileInfo.duration = parseDuration(animation.totalDuration);
  }

  // Audio duration (formatted as "4.230s" or "N/A")
  const audio = responseData.audio as Record<string, unknown> | null;
  if (audio && fileInfo.duration === null) {
    fileInfo.duration = parseDuration(audio.duration);
  }

  // Extract generation params — prefer sogniDetails, fall back to A1111
  let generation: GenerationParams | null = null;
  let source: string | null = null;

  const sogniDetails = responseData.sogniDetails as Record<string, unknown> | null;
  if (sogniDetails) {
    const curated = curateFromSogniDetails(sogniDetails);
    if (hasGenerationData(curated)) {
      generation = curated;
      source = 'comfyui';
    }
  }

  if (!generation) {
    const genParams = responseData.generationParams as Record<string, unknown> | null;
    if (genParams) {
      const curated = curateFromA1111(genParams);
      if (hasGenerationData(curated)) {
        generation = curated;
        source = 'a1111';
      }
    }
  }

  const hasMetadata = generation !== null;

  const result: Record<string, unknown> = {
    success: true,
    hasMetadata,
    source,
    file: fileInfo,
    generation,
  };

  if (usedFallback) {
    result.note = `File index ${fileIndex} out of bounds, inspected first file instead.`;
  }

  if (!hasMetadata) {
    result.message = 'No generation metadata found. The file may not be AI-generated, or its metadata may have been stripped during editing, compression, or sharing.';
  }

  // Signal completion so suggestion chips render
  callbacks.onToolComplete('extract_metadata', []);

  console.log(`[METADATA] Done — hasMetadata=${hasMetadata}, source=${source}`);
  return JSON.stringify(result);
}
