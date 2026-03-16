# animate_photo Start/End Frame Support

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to specify whether their uploaded image is the start frame, end frame, or provide both start and end frames for video interpolation in the `animate_photo` tool.

**Architecture:** Add a `frameRole` parameter to the tool definition that controls how the source image is used. Extend the `videoGeneration.ts` service to accept optional end-frame data and pass `referenceImageEnd`, `firstFrameStrength`, and `lastFrameStrength` through to the Sogni SDK. The handler resolves the end frame image from uploads/results using a new `endImageIndex` parameter.

**Tech Stack:** TypeScript, Sogni Client SDK (`referenceImageEnd`, `firstFrameStrength`, `lastFrameStrength` on `VideoProjectParams`)

**Verification:** `npm run build` (TypeScript strict mode) + `npm run lint` (ESLint)

---

## Frame Role → SDK Parameter Mapping

| `frameRole` | `referenceImage` (SDK) | `referenceImageEnd` (SDK) | `firstFrameStrength` | `lastFrameStrength` |
|---|---|---|---|---|
| `"start"` (default) | sourceImageData | — | — (SDK default 0.6) | — |
| `"end"` | — (null) | sourceImageData | 0 (disabled) | 0.9 (strong match) |
| `"both"` | sourceImageData | endImageData | — (SDK default 0.6) | — (SDK default 0.6) |

All i2v models (WAN 2.2, LTX-2, LTX 2.3) support `referenceImageEnd`. The server requires at least ONE of `referenceImage` or `referenceImageEnd`. `firstFrameStrength`/`lastFrameStrength` are pass-through params — the server and worker handle defaults.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/sdk/videoGeneration.ts` | Modify | Make `imageData` nullable; add `endImageData`, `firstFrameStrength`, `lastFrameStrength`; conditionally pass to SDK |
| `src/tools/animate-photo/definition.ts` | Modify | Add `frameRole` and `endImageIndex` parameters to tool schema |
| `src/tools/animate-photo/handler.ts` | Modify | Resolve end frame image; compose SDK params based on `frameRole` |

3 files total. No new files needed.

---

## Chunk 1: Implementation

### Task 1: Extend `VideoGenerationParams` and pass end-frame data to SDK

**Files:**
- Modify: `src/services/sdk/videoGeneration.ts:16-34` (VideoGenerationParams interface)
- Modify: `src/services/sdk/videoGeneration.ts:64-107` (destructuring + projectConfig construction)

- [ ] **Step 1: Update `VideoGenerationParams` interface — make `imageData` nullable and add end-frame fields**

```typescript
export interface VideoGenerationParams {
  /** Start frame image data. Null when using end-frame-only mode. */
  imageData: Uint8Array | null;
  width: number;
  height: number;
  tokenType: TokenType;
  prompt: string;
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
}
```

- [ ] **Step 2: Update projectConfig construction to conditionally set `referenceImage`**

Replace the existing Blob creation + projectConfig block (lines ~83-107) with:

```typescript
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
    projectConfig.referenceImage = new Blob([new Uint8Array(imageData)], { type: 'image/jpeg' });
  }

  // End frame for keyframe interpolation
  if (params.endImageData) {
    projectConfig.referenceImageEnd = new Blob([new Uint8Array(params.endImageData)], { type: 'image/jpeg' });
  }

  // Frame strength controls
  if (params.firstFrameStrength !== undefined) {
    projectConfig.firstFrameStrength = params.firstFrameStrength;
  }
  if (params.lastFrameStrength !== undefined) {
    projectConfig.lastFrameStrength = params.lastFrameStrength;
  }
```

- [ ] **Step 3: Update the console.log to handle nullable imageData**

Replace line ~73-81:

```typescript
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
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation, no type errors. (The handler still passes `Uint8Array` for `imageData`, which is assignable to `Uint8Array | null`.)

- [ ] **Step 5: Commit**

```bash
git add src/services/sdk/videoGeneration.ts
git commit -m "feat(video): add end-frame and frame-strength params to VideoGenerationParams"
```

---

### Task 2: Add `frameRole` and `endImageIndex` to tool definition

**Files:**
- Modify: `src/tools/animate-photo/definition.ts:13-14` (tool description)
- Modify: `src/tools/animate-photo/definition.ts:63-73` (parameters block, after sourceImageIndex)

- [ ] **Step 1: Update tool description to mention frame role capability**

In the `description` field (line 13-14), insert this sentence immediately before `CRITICAL: If the user's request is vague`:

```
Supports start-frame (default), end-frame, and start+end interpolation modes — ask the user which frame role their image should play if they mention "end frame", "last frame", or provide two images.
```

- [ ] **Step 2: Add `frameRole` parameter**

Add after the `sourceImageIndex` property block (after line ~66):

```typescript
        frameRole: {
          type: 'string',
          enum: ['start', 'end', 'both'],
          description:
            'How to use the source image(s) for video generation. "start" (default): image is the first frame — video animates forward from it. "end": image is the last frame — video leads up to it. "both": two images provided — source image is the start frame, endImageIndex specifies the end frame, and the video interpolates between them. Only set when the user explicitly indicates their image should be the end frame or provides two images for interpolation.',
        },
```

- [ ] **Step 3: Add `endImageIndex` parameter**

Add after `frameRole`:

```typescript
        endImageIndex: {
          type: 'number',
          description:
            'Which image to use as the END frame (0-based index into results). Only used when frameRole is "both". Use -1 for the primary/first uploaded image. If omitted when frameRole is "both", uses the second uploaded image if available.',
        },
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add src/tools/animate-photo/definition.ts
git commit -m "feat(animate-photo): add frameRole and endImageIndex tool parameters"
```

---

### Task 3: Implement frame role logic in handler

**Files:**
- Modify: `src/tools/animate-photo/handler.ts:112-123` (args parsing)
- Modify: `src/tools/animate-photo/handler.ts:178-181` (after source image resolution)
- Modify: `src/tools/animate-photo/handler.ts:293-306` (video generation call)

This is the core change. The handler must:
1. Parse `frameRole` and `endImageIndex` from args
2. Resolve the end frame image (from uploads, results, or primary image)
3. For `frameRole: "end"`: image becomes end frame, null start
4. For `frameRole: "both"`: resolve both start and end images
5. Pass end-frame data and strength params to `generateVideo()`

- [ ] **Step 1: Parse new args at the top of `execute()`**

After line 122 (`const aspectRatio = args.aspectRatio as string | undefined;`), add:

```typescript
  const frameRole = (args.frameRole as string) || 'start';
  const rawEndImageIndex = args.endImageIndex as number | undefined;
```

- [ ] **Step 2: Add end frame resolution after source image resolution**

After the `if (!sourceImageData)` guard (around line 181), add:

```typescript
  // ---------------------------------------------------------------------------
  // Resolve end frame image (for "end" and "both" modes)
  // ---------------------------------------------------------------------------
  let endImageData: Uint8Array | null = null;

  if (frameRole === 'end') {
    // User's image IS the end frame — it will be sent as referenceImageEnd only.
    // sourceImageData is still used for vision description (LTX 2.3 prompt anchoring)
    // so the prompt describes what the video converges toward.
    endImageData = sourceImageData;
  } else if (frameRole === 'both') {
    // Resolve end frame from endImageIndex, uploaded files, or second uploaded image
    if (rawEndImageIndex === -1 && context.imageData) {
      // Explicit: use primary uploaded image as end frame
      endImageData = context.imageData;
    } else if (rawEndImageIndex !== undefined && rawEndImageIndex >= 0 && context.resultUrls[rawEndImageIndex]) {
      // Use a specific result image as end frame
      try {
        const fetched = await fetchImageAsUint8Array(context.resultUrls[rawEndImageIndex]);
        endImageData = fetched.data;
        console.log(`[ANIMATE] End frame from result #${rawEndImageIndex}: ${fetched.width}x${fetched.height}`);
      } catch (err) {
        console.error('[ANIMATE] Failed to fetch end frame image:', err);
        return JSON.stringify({ error: 'fetch_failed', message: 'Could not retrieve the end frame image.' });
      }
    } else {
      // Auto: look for a second uploaded image
      const imageFiles = context.uploadedFiles.filter(f => f.type === 'image');
      if (imageFiles.length >= 2) {
        endImageData = imageFiles[1].data;
        console.log(`[ANIMATE] End frame from second uploaded image: ${imageFiles[1].filename}`);
      } else {
        return JSON.stringify({ error: 'missing_end_frame', message: 'frameRole is "both" but no end frame image was found. Please upload a second image or specify endImageIndex.' });
      }
    }
  }

  console.log(`[ANIMATE] Frame role: ${frameRole}, hasEndImage: ${!!endImageData}`);
```

- [ ] **Step 3: Update `generateVideo()` call to pass end-frame params**

Replace the `runVideoGeneration` call (around line 293) with:

```typescript
  // For "end" mode: don't send the image as start frame (referenceImage),
  // only as end frame (referenceImageEnd)
  const startImageData = frameRole === 'end' ? null : sourceImageData;

  const runVideoGeneration = (tokenType: TokenType) => generateVideo(
    context.sogniClient,
    {
      imageData: startImageData,
      width: sourceWidth,
      height: sourceHeight,
      tokenType,
      prompt: composedPrompt,
      duration,
      videoModelId,
      numberOfMedia,
      aspectRatio,
      targetResolution,
      disableNSFWFilter: context.safeContentFilter === false,
      ...(endImageData ? { endImageData } : {}),
      ...(frameRole === 'end' ? { firstFrameStrength: 0, lastFrameStrength: 0.9 } : {}),
    },
```

The rest of the `runVideoGeneration` function (progress callback, signal) remains unchanged.

**Note on vision description:** The existing `describeImageForVideo()` call uses `sourceImageData`, which in "end" mode is the user's end-frame image. This is correct — the prompt will describe what the video converges toward.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation, no type errors.

- [ ] **Step 5: Verify lint**

Run: `npm run lint`
Expected: No new warnings (max 16 allowed).

- [ ] **Step 6: Commit**

```bash
git add src/tools/animate-photo/handler.ts
git commit -m "feat(animate-photo): implement start/end frame resolution and SDK passthrough"
```

---

### Task 4: Verify end-to-end integration

- [ ] **Step 1: Full build verification**

Run: `npm run build`
Expected: Clean exit, no errors.

- [ ] **Step 2: Lint verification**

Run: `npm run lint`
Expected: Passes within the 16-warning threshold.

- [ ] **Step 3: useEffect validation**

Run: `npm run validate:useeffect`
Expected: No new violations.

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: fixup lint/build issues from start-end-frame feature"
```
