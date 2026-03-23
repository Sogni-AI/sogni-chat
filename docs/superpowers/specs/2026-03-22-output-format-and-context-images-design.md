# Output Format Control & Context Images for generate_image

## Overview

Two independent enhancements to the image generation tools:

1. **Output format (jpg/png)**: Add `outputFormat` parameter to all 6 image generation tools so users can request PNG when they need transparency or lossless quality. Default: `'jpg'`.
2. **Context images for generate_image**: Allow users to provide reference images during text-to-image generation, passed as `contextImages` to the SDK. Supports up to 6 images depending on model.

---

## Feature 1: Output Format Control

### Current State

| Tool | outputFormat in definition? | Handler passes it? | Service supports it? | Current value |
|------|---|---|---|---|
| generate_image | No | No | N/A (direct SDK call) | SDK default (png) |
| edit_image | No | No | N/A (direct SDK call) | `'jpg'` hardcoded |
| restore_photo | No | No | Yes (optional param) | Quality preset (`'jpg'`) |
| apply_style | No | No | Yes (optional param) | `'jpg'` default |
| change_angle | No | No | No (hardcoded) | `'jpg'` hardcoded |
| refine_result | No | No | Yes (optional param) | Quality preset (`'jpg'`) |

### Design

Add an `outputFormat` parameter to every image tool's `definition.ts`. Each handler parses it and passes it to the SDK or service layer. Default: `'jpg'`.

**Tool definition parameter** (identical across all 6 tools):
```typescript
outputFormat: {
  type: 'string',
  enum: ['jpg', 'png'],
  description: 'Image output format. "jpg" (default): smaller file, no transparency. "png": lossless, supports transparency. Only set when the user explicitly requests a format.',
},
```

**Handler change pattern**: Parse `args.outputFormat as 'jpg' | 'png' | undefined` and pass to SDK/service. Default to `'jpg'` if not specified.

### File Map

| File | Change |
|------|--------|
| `src/tools/generate-image/definition.ts` | Add `outputFormat` param |
| `src/tools/generate-image/handler.ts` | Parse and pass to projectParams |
| `src/tools/edit-image/definition.ts` | Add `outputFormat` param |
| `src/tools/edit-image/handler.ts` | Parse instead of hardcoding `'jpg'` |
| `src/tools/restore-photo/definition.ts` | Add `outputFormat` param |
| `src/tools/restore-photo/handler.ts` | Parse and pass to `restorePhoto()` service |
| `src/tools/apply-style/definition.ts` | Add `outputFormat` param |
| `src/tools/apply-style/handler.ts` | Parse and pass to `applyStyle()` service |
| `src/tools/change-angle/definition.ts` | Add `outputFormat` param |
| `src/tools/change-angle/handler.ts` | Parse and pass to `generateAngle()` service |
| `src/services/sdk/angleGeneration.ts` | Add `outputFormat` to `AngleGenerationParams` interface, use instead of hardcoded `'jpg'` |
| `src/tools/refine-result/definition.ts` | Add `outputFormat` param |
| `src/tools/refine-result/handler.ts` | Parse and pass to `restorePhoto()` service |

13 files. All changes are mechanical — add param to definition, parse in handler, pass through.

---

## Feature 2: Context Images for generate_image

### Current State

`generate_image` supports single-image img2img via `startingImage` + `startingImageStrength`, but has no support for multi-reference `contextImages`. The `edit_image` tool already implements full context image support with model-dependent caps (Flux.2 Dev = 6, Qwen = 3).

### Design

When the user uploads reference images alongside a generation request (e.g., "generate an image like these but with a sunset background"), the handler gathers them from `context.uploadedFiles` and passes them as `contextImages` to the SDK.

**Tool definition parameter:**
```typescript
useReferenceImages: {
  type: 'boolean',
  description: 'Whether to use uploaded images as style/content references for generation. Set to true when the user provides reference images and wants the output to be influenced by them. Only applicable to models that support context images (e.g., Flux.2 Dev supports up to 6).',
},
```

**Handler logic:**
1. If `useReferenceImages` is true, call `gatherContextImages()` (reuse from edit_image or extract to shared utility)
2. Cap to model's `maxContextImages` limit
3. Convert to Blob array and add to projectParams
4. Include context image count in cost estimation

**Model config addition:** Add `maxContextImages` field to `ImageModelConfig` for models that support it. Models without the field default to 0 (no context images).

**Which models support contextImages:**
- Flux.2 Dev (`flux2_dev_fp8`): up to 6
- Other Flux models: TBD (check SDK at implementation time)
- Non-Flux models: 0 (not supported)

If the user requests reference images but the selected model doesn't support them, the LLM response should suggest switching to a compatible model, or the handler returns an informative error.

### File Map

| File | Change |
|------|--------|
| `src/tools/generate-image/definition.ts` | Add `useReferenceImages` param |
| `src/tools/generate-image/handler.ts` | Add `maxContextImages` to model configs, gather context images, pass to SDK, update cost estimation |
| `src/tools/shared/contextImages.ts` | New file: extract `gatherContextImages()` from edit_image for reuse |
| `src/tools/edit-image/handler.ts` | Import shared `gatherContextImages()` instead of local copy |

4 files (1 new shared utility).

---

## Verification

- `npm run build` — TypeScript strict mode, no errors
- `npm run lint` — ESLint, max 16 warnings
