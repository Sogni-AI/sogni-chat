# Extract Metadata Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `extract_metadata` LLM tool that parses generation metadata from uploaded media files via the sogni-metadata service, returning actionable parameters for reuse by other tools.

**Architecture:** New tool module under `src/tools/extract-metadata/` following the self-registration pattern. The handler creates a `FormData` from `context.uploadedFiles[index].data`, POSTs to `https://metadata.sogni.ai/api/inspect`, and curates the response into a compact schema with `positivePrompt`, `model`, `steps`, `seed`, `cfg`, etc. A CORS middleware addition to the sogni-metadata repo enables cross-origin requests from `*.sogni.ai`.

**Tech Stack:** Browser-native `fetch`, `FormData`, `Blob`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-15-extract-metadata-tool-design.md`

---

## Chunk 1: CORS + Tool Registration + Implementation

### Task 1: Add CORS middleware to sogni-metadata

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-metadata/server.js:12` (before `app.use(express.static(...))`)

- [ ] **Step 1: Add CORS middleware**

Insert before line 18 (`app.use(express.static(...))`):

```javascript
// CORS: allow all *.sogni.ai subdomains
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const hostname = new URL(origin).hostname;
      if (hostname === 'sogni.ai' || hostname.endsWith('.sogni.ai')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
    } catch { /* invalid origin, skip */ }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-metadata
git add server.js
git commit -m "Add CORS middleware for *.sogni.ai subdomains"
```

---

### Task 2: Register extract_metadata in tool types and index

**Files:**
- Modify: `src/tools/types.ts:68-82` (add to ToolName union)
- Modify: `src/tools/index.ts:28` (add import)

- [ ] **Step 1: Add `extract_metadata` to ToolName union**

In `src/tools/types.ts`, add `'extract_metadata'` to the union and update the comment:

```typescript
/** Tool name union — expanded from original 5 to 14 tools */
export type ToolName =
  | 'restore_photo'
  | 'apply_style'
  | 'refine_result'
  | 'animate_photo'
  | 'change_angle'
  | 'generate_image'
  | 'edit_image'
  | 'generate_video'
  | 'sound_to_video'
  | 'video_to_video'
  | 'generate_music'
  | 'analyze_image'
  | 'set_content_filter'
  | 'extract_metadata';
```

- [ ] **Step 2: Add import to tools/index.ts**

After the `set-content-filter` import (line 28), add:

```typescript
// Metadata extraction
import './extract-metadata';
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/types.ts src/tools/index.ts
git commit -m "Register extract_metadata in tool types and index"
```

---

### Task 3: Create tool definition

**Files:**
- Create: `src/tools/extract-metadata/definition.ts`

- [ ] **Step 1: Write definition.ts**

```typescript
import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'extract_metadata',
    description:
      'Extracts generation metadata (prompt, model, parameters) from an uploaded media file. ' +
      'Use this when the user asks about an uploaded file\'s original prompt, generation settings, or metadata — ' +
      'or when you need the original parameters to recreate, remix, or generate new versions of an uploaded file. ' +
      'The extracted parameters (prompt, model, steps, seed, cfg, sampler, dimensions, LoRAs) can be fed directly ' +
      'into tools like generate_image, generate_video, etc. ' +
      'Supports PNG, JPEG, WebP, HEIF/AVIF, GIF, MP4, WebM, and MOV files.',
    parameters: {
      type: 'object',
      properties: {
        file_index: {
          type: 'number',
          description:
            'Index of the uploaded file to inspect (0-based). Defaults to 0 (the first uploaded file). ' +
            'Only indexes into user-uploaded files, not previously generated results.',
        },
      },
      required: [],
    },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/extract-metadata/definition.ts
git commit -m "Add extract_metadata tool definition"
```

---

### Task 4: Create tool handler

**Files:**
- Create: `src/tools/extract-metadata/handler.ts`

- [ ] **Step 1: Write handler.ts**

```typescript
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
  if (Array.isArray(details.loras)) gen.loras = details.loras;
  return gen;
}

/** Curate A1111-format generationParams into our schema */
function curateFromA1111(params: Record<string, unknown>): GenerationParams {
  const gen: GenerationParams = {};
  if (typeof params.positivePrompt === 'string') gen.positivePrompt = params.positivePrompt;
  if (typeof params.negativePrompt === 'string') gen.negativePrompt = params.negativePrompt;
  if (typeof params.Model === 'string') gen.model = params.Model;
  if (typeof params.Steps === 'string') gen.steps = parseInt(params.Steps, 10) || undefined;
  if (typeof params.Seed === 'string') gen.seed = parseInt(params.Seed, 10) || undefined;
  if (typeof params['CFG scale'] === 'string') gen.cfg = parseFloat(params['CFG scale']) || undefined;
  if (typeof params.Sampler === 'string') gen.sampler = params.Sampler;
  if (typeof params['Schedule type'] === 'string') gen.scheduler = params['Schedule type'];
  if (typeof params['Denoising strength'] === 'string') gen.denoise = parseFloat(params['Denoising strength']) || undefined;
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
  _callbacks: ToolCallbacks,
): Promise<string> {
  // Resolve file index
  const fileIndex = typeof args.file_index === 'number' ? Math.floor(args.file_index) : 0;

  if (!context.uploadedFiles || context.uploadedFiles.length === 0) {
    return JSON.stringify({ error: 'no_file', message: 'Please upload a file first.' });
  }

  const file = context.uploadedFiles[fileIndex] ?? context.uploadedFiles[0];
  const usedFallback = fileIndex > 0 && !context.uploadedFiles[fileIndex];

  console.log(`[METADATA] Inspecting file: ${file.filename} (${file.mimeType}, index=${fileIndex}${usedFallback ? ', fell back to 0' : ''})`);

  // Build FormData with file blob
  const formData = new FormData();
  const blob = new Blob([file.data], { type: file.mimeType });
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
      const errBody = await response.json().catch(() => null);
      const message = (errBody as Record<string, unknown>)?.error ?? `HTTP ${response.status} ${response.statusText}`;
      console.error(`[METADATA] Service error: ${message}`);
      return JSON.stringify({ error: 'inspection_failed', message: String(message) });
    }

    responseData = await response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err; // Let the registry handle abort/timeout
    }
    console.error('[METADATA] Network error:', err);
    return JSON.stringify({ error: 'service_unavailable', message: 'Could not reach the metadata service.' });
  }

  console.log('[METADATA] Response received, curating fields');

  // Extract file info
  const fileInfo: Record<string, unknown> = {
    format: responseData.file && typeof responseData.file === 'object'
      ? (responseData.file as Record<string, unknown>).detectedFormat ?? null
      : null,
    width: null,
    height: null,
    duration: null,
  };

  // Dimensions from image or video
  const image = responseData.image as Record<string, unknown> | null;
  const video = responseData.video as Record<string, unknown> | null;
  if (image) {
    fileInfo.width = (image as Record<string, unknown>).width ?? null;
    fileInfo.height = (image as Record<string, unknown>).height ?? null;
  } else if (video) {
    const stream = (video as Record<string, unknown>).stream as Record<string, unknown> | null;
    if (stream) {
      fileInfo.width = stream.width ?? null;
      fileInfo.height = stream.height ?? null;
    }
    const container = (video as Record<string, unknown>).container as Record<string, unknown> | null;
    if (container) {
      fileInfo.duration = container.duration ?? null;
    }
  }

  // Audio duration
  const audio = responseData.audio as Record<string, unknown> | null;
  if (audio && !fileInfo.duration) {
    fileInfo.duration = (audio as Record<string, unknown>).duration ?? null;
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
    hasMetadata,
    source,
    file: fileInfo,
    generation,
  };

  if (usedFallback) {
    result.note = `File index ${fileIndex} out of bounds, inspected first file instead.`;
  }

  console.log(`[METADATA] Done — hasMetadata=${hasMetadata}, source=${source}`);
  return JSON.stringify(result);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/extract-metadata/handler.ts
git commit -m "Add extract_metadata tool handler"
```

---

### Task 5: Create tool self-registration

**Files:**
- Create: `src/tools/extract-metadata/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: 'Generate a new version', prompt: 'Generate a new version of this image using the extracted settings' },
    { label: 'Different prompt, same settings', prompt: 'Use these generation settings but with a different prompt' },
    { label: 'What model was used?', prompt: 'What model was used to generate this?' },
  ],
});
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/extract-metadata/index.ts
git commit -m "Add extract_metadata self-registration with suggestion chips"
```

---

### Task 6: Add context-aware suggestions in chatSuggestions.ts

**Files:**
- Modify: `src/utils/chatSuggestions.ts:9-21` (add to ChatToolName union)
- Modify: `src/utils/chatSuggestions.ts:53-117` (add to SUGGESTIONS_BY_TOOL)

- [ ] **Step 1: Add `extract_metadata` to ChatToolName union**

In `src/utils/chatSuggestions.ts`, add `'extract_metadata'` to the `ChatToolName` union (after `'analyze_image'` on line 21):

```typescript
  | 'analyze_image'
  | 'extract_metadata';
```

- [ ] **Step 2: Add SUGGESTIONS_BY_TOOL entry**

After the `analyze_image` entry (line 116), add:

```typescript
  extract_metadata: [
    { label: 'Generate a new version', prompt: 'Generate a new version of this image using the extracted settings' },
    { label: 'Different prompt, same settings', prompt: 'Use these generation settings but with a different prompt' },
    { label: 'What model was used?', prompt: 'What model was used to generate this?' },
  ],
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/chatSuggestions.ts
git commit -m "Add extract_metadata to context-aware chat suggestions"
```

---

### Task 7: Verify build

- [ ] **Step 1: Run TypeScript check + lint**

```bash
npm run build
npm run lint
```

Expected: No errors. The build should succeed with the new tool registered.

- [ ] **Step 2: Commit any fixes if needed**
