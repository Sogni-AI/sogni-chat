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

**Note:** `generate_image` currently does not set `outputFormat` at all, so the SDK defaults to `png`. Adding a default of `'jpg'` is an intentional behavioral change — aligns generate_image with every other tool and produces smaller files. Users who need PNG can explicitly request it.

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

**Handler integration paths** (three distinct patterns):

1. **Direct SDK call** (generate_image, edit_image): Parse `args.outputFormat`, add to `projectParams` object. Also add to their internal `ImageGenParams`/`EditGenParams` interfaces.
2. **restorePhoto() service** (restore_photo, refine_result): Parse `args.outputFormat`, pass as `outputFormat` in `RestorationParams` (interface already supports it).
3. **Dedicated service** (apply_style → `applyStyle()`, change_angle → `generateAngle()`): Parse `args.outputFormat`, pass to service. `StyleTransferParams` already supports it. `AngleGenerationParams` needs the field added.

Default to `'jpg'` if not specified across all paths.

### File Map

| File | Change |
|------|--------|
| `src/tools/generate-image/definition.ts` | Add `outputFormat` param |
| `src/tools/generate-image/handler.ts` | Parse, add to `ImageGenParams` interface and `projectParams` |
| `src/tools/edit-image/definition.ts` | Add `outputFormat` param |
| `src/tools/edit-image/handler.ts` | Parse, add to `EditGenParams` interface, replace hardcoded `'jpg'` |
| `src/tools/restore-photo/definition.ts` | Add `outputFormat` param |
| `src/tools/restore-photo/handler.ts` | Parse and pass to `restorePhoto()` service |
| `src/tools/apply-style/definition.ts` | Add `outputFormat` param |
| `src/tools/apply-style/handler.ts` | Parse and pass to `applyStyle()` service |
| `src/tools/change-angle/definition.ts` | Add `outputFormat` param |
| `src/tools/change-angle/handler.ts` | Parse and pass to `generateAngle()` service |
| `src/services/sdk/angleGeneration.ts` | Add `outputFormat` to `AngleGenerationParams` interface, use instead of hardcoded `'jpg'` |
| `src/tools/refine-result/definition.ts` | Add `outputFormat` param |
| `src/tools/refine-result/handler.ts` | Parse and pass to `restorePhoto()` service |

13 files total.

---

## Feature 2: Context Images for generate_image

### Current State

`generate_image` supports single-image img2img via `startingImage` + `startingImageStrength`, but has no support for multi-reference `contextImages`. The `edit_image` tool already implements full context image support with model-dependent caps (Flux.2 Dev = 6, Qwen = 3).

**img2img vs context images:** img2img uses one image as a starting point with a blend strength — the model modifies the image. Context images are reference inputs that influence style/content without modifying any single image. The tool description must clarify when to use each so the LLM picks the right path.

### Design

When the user uploads reference images alongside a generation request (e.g., "generate an image like these but with a sunset background"), the handler gathers them from `context.uploadedFiles` and passes them as `contextImages` to the SDK.

**Tool definition parameter:**
```typescript
useReferenceImages: {
  type: 'boolean',
  description: 'Whether to use uploaded images as style/content references for generation. Set true when the user provides images and wants output influenced by their style or content — NOT for img2img blending (use starting_image_strength for that). Only works with models that support context images (e.g., Flux.2 Dev up to 6). If the model does not support context images, this is silently ignored.',
},
```

**Tool description update:** The `generate_image` description must be updated to replace "No reference photos — creates from text alone" with language that permits context images: "Creates from text. When useReferenceImages is true, uploaded images are used as style/content references (not for identity preservation — use edit_image for that)."

**Handler logic:**
1. If `useReferenceImages` is true, call shared `gatherContextImages()`
2. Check model's `maxContextImages` (optional field, defaults to 0)
3. If model supports context images: cap to limit, convert to Blob array, add to `projectParams`, include count in cost estimation via `fetchImageCostEstimate()`
4. If model does not support context images: silently ignore (don't error — the text prompt still works fine)

**Model config addition:** Add optional `maxContextImages?: number` to `ImageModelConfig`. Only models that support it get a value. Absent = 0 (no support). Known support:
- Flux.2 Dev (`flux2_dev_fp8`): 6
- Other models: check at implementation time

**Shared utility extraction:** Move `gatherContextImages()` and `ContextImageEntry` interface from `edit_image/handler.ts` to `src/tools/shared/contextImages.ts`. Re-export from `src/tools/shared/index.ts`. Update `edit_image/handler.ts` to import from shared.

### File Map

| File | Change |
|------|--------|
| `src/tools/generate-image/definition.ts` | Add `useReferenceImages` param, update tool description |
| `src/tools/generate-image/handler.ts` | Add `maxContextImages` to relevant model configs, gather context images, pass to SDK, update cost estimation |
| `src/tools/shared/contextImages.ts` | **New file**: `gatherContextImages()` + `ContextImageEntry` extracted from edit_image |
| `src/tools/shared/index.ts` | Re-export from `contextImages.ts` |
| `src/tools/edit-image/handler.ts` | Import `gatherContextImages` and `ContextImageEntry` from shared instead of local |

5 files (1 new shared utility).

---

## Verification

- `npm run build` — TypeScript strict mode, no errors
- `npm run lint` — ESLint, max 16 warnings
