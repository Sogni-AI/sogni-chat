# Extract Metadata Tool — Design Spec

## Overview

Add an `extract_metadata` tool to the LLM tool registry that parses generation metadata from uploaded media files. The tool calls the existing sogni-metadata service (`metadata.sogni.ai`) and returns curated, actionable fields — prompts, model, dimensions, sampler params, LoRAs — that the LLM can use to answer metadata questions or feed directly into other tools like `generate_image`.

## Motivation

When a user uploads an AI-generated image and asks "generate new versions of this," the LLM currently has to visually inspect the image and guess at parameters. If the file contains embedded generation metadata (ComfyUI workflow, A1111 params, EXIF), we can extract the exact prompt, model, seed, cfg, steps, etc. and reuse them — producing far more accurate results.

## Supported Media

All formats supported by sogni-metadata: PNG (tEXt/iTXt/zTXt chunks), JPEG (EXIF UserComment), WebP (EXIF/XMP), HEIF/AVIF, GIF, MP4, WebM, MOV.

## Architecture

### Data Flow

1. User uploads a file and asks about its metadata/original prompt
2. LLM calls `extract_metadata` (optionally specifying `file_index`)
3. Tool handler creates `FormData` with `Blob` from `context.uploadedFiles[index].data`
4. `POST https://metadata.sogni.ai/api/inspect` (multipart/form-data)
5. Tool parses response, extracts curated fields
6. Returns JSON to LLM
7. LLM responds naturally or uses extracted params in subsequent tool calls

### File Index Resolution

`file_index` indexes into `context.uploadedFiles` only (0-based). Generated results (`context.resultUrls`) are excluded — they were produced by Sogni and their generation params are already known from the tool call that created them.

### No Backend Changes in sogni-chat

The tool runs entirely client-side via browser `fetch()`. No new dependencies.

### CORS Change in sogni-metadata

Add middleware to `server.js` allowing all `*.sogni.ai` subdomains, including OPTIONS preflight handling:

```javascript
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /\.sogni\.ai$/.test(new URL(origin).hostname)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

No new npm dependency needed.

## Tool Definition

**Name**: `extract_metadata`

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file_index` | number | No | Which uploaded file to inspect (0-based index into uploadedFiles). Defaults to 0. |

**Description** (for LLM): Extracts generation metadata (prompt, model, parameters) from an uploaded media file. Use this when the user asks about an uploaded file's original prompt, generation settings, or metadata — or when you need the original parameters to recreate, remix, or generate new versions of an uploaded file. The extracted parameters can be fed directly into tools like generate_image, generate_video, etc.

## Return Schema

### Success (metadata found)

```json
{
  "hasMetadata": true,
  "source": "comfyui",
  "file": {
    "format": "PNG",
    "width": 1024,
    "height": 1024,
    "duration": null
  },
  "generation": {
    "positivePrompt": "a serene mountain landscape at sunset...",
    "negativePrompt": "blurry, low quality",
    "model": "flux1-dev-fp8",
    "width": 1024,
    "height": 1024,
    "steps": 30,
    "seed": 123456789,
    "cfg": 7.5,
    "sampler": "euler",
    "scheduler": "normal",
    "denoise": 1.0,
    "loras": [
      { "name": "detail_enhancer", "strength": 0.8 }
    ]
  }
}
```

`source` indicates where metadata was extracted from: `"comfyui"`, `"a1111"`, or `"exif"`.

### Success (no metadata found)

```json
{
  "hasMetadata": false,
  "source": null,
  "file": {
    "format": "JPEG",
    "width": 1920,
    "height": 1080,
    "duration": null
  },
  "generation": null
}
```

### Error

```json
{
  "error": "no_file",
  "message": "Please upload a file first."
}
```

## File Structure

```
src/tools/extract-metadata/
  definition.ts    — OpenAI function schema
  handler.ts       — fetch + response curation
  index.ts         — self-registration
```

## Registration

- Add `import './extract-metadata'` to `src/tools/index.ts`
- Add `'extract_metadata'` to `ToolName` union in `src/tools/types.ts`

## Suggestion Chips

After tool completes:
- "Generate a new version of this image"
- "Use these settings with a different prompt"
- "What model was used?"

## Response Curation Logic

The metadata service returns a large response with fields: `file`, `image`, `video`, `audio`, `animation`, `comfyui`, `sogniDetails`, `generationParams`, `exif`, `xmp`, `pngChunks`, `errors`.

The tool curates this into the return schema above:

1. **file info**: `format` from `file.detectedFormat.format`, dimensions from `image` or `video.stream`, `duration` from `video.container.duration` or `audio`
2. **generation params**: Prefer `sogniDetails` (Sogni/ComfyUI parsed). Fall back to `generationParams` (A1111 format). If neither exists, `hasMetadata = false`.
3. **Field mapping from sogniDetails** (source: `"comfyui"`):
   - `positivePrompt` → `generation.positivePrompt`
   - `negativePrompt` → `generation.negativePrompt`
   - `model` (from `ckpt_name` or `unet_name`) → `generation.model`
   - `width`, `height` → `generation.width`, `generation.height`
   - `steps`, `seed`, `cfg`, `sampler`, `scheduler`, `denoise` → direct mapping
   - `loras` → `generation.loras`
4. **Field mapping from generationParams** (source: `"a1111"`, fallback):
   - `Prompt` → `generation.positivePrompt`
   - `Negative prompt` → `generation.negativePrompt`
   - `Model` → `generation.model`
   - `Size` (e.g., "1024x1024") → `generation.width`, `generation.height` (split on `x`)
   - `Steps` → `generation.steps`
   - `Seed` → `generation.seed`
   - `CFG scale` → `generation.cfg`
   - `Sampler` → `generation.sampler`
   - `Schedule type` → `generation.scheduler`
   - `Denoising strength` → `generation.denoise`

## Error Handling

| Scenario | Response |
|----------|----------|
| No file uploaded | `{ error: 'no_file', message: 'Please upload a file first.' }` |
| File index out of bounds | Fall back to first file, include note |
| Network failure | `{ error: 'service_unavailable', message: 'Could not reach the metadata service.' }` |
| HTTP 4xx/5xx | `{ error: 'inspection_failed', message: '<status text from response>' }` |
| Malformed response JSON | `{ error: 'parse_error', message: 'Failed to parse metadata service response.' }` |
| No generation metadata | `{ hasMetadata: false, file: {...}, generation: null }` |
| Unsupported format | Metadata service returns basic file info, we pass through |

## Implementation Notes

- **Abort support**: Pass `context.signal` to `fetch()` so cancellation and the registry's 5-minute timeout are respected.
- **No `onToolComplete`**: This tool does not call `callbacks.onToolComplete()` — it returns text metadata, not media URLs. Follows the `set_content_filter` precedent.
- **Unused `callbacks` param**: Prefix as `_callbacks` to satisfy `noUnusedParameters`.
- **Console log prefix**: Use `[METADATA]` for all console logs in the handler.
- **Context-aware suggestions**: Also add an entry in `src/utils/chatSuggestions.ts` so "Extract metadata" appears when a file is uploaded.

## Key Properties

- **No credit cost** — pure read operation, no SDK job
- **No progress callbacks** — single fetch call, fast response
- **No new dependencies** — uses browser-native FormData, Blob, fetch
- **Actionable output** — fields map directly to other tool parameters
