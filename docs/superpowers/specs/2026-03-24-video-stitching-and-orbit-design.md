# Video Stitching & Orbit Video Design

**Date:** 2026-03-24
**Status:** Approved

## Overview

Add video stitching capability to Sogni Chat by porting the battle-tested `mp4box`-based concatenation from sogni-photobooth, introducing a reusable `ToolPipeline` abstraction for multi-step tool orchestration, and building two new tools: `stitch_video` (general-purpose concatenation) and `orbit_video` (360° orbit composite workflow).

## Goals

1. Users can ask "create a 360 degree pan around this image" and get a seamless looping orbit video
2. Users can stitch any previously-generated video clips together via chat
3. A well-documented pipeline framework exists for future multi-step composite tools

## Non-Goals

- Audio muxing/looping (can be added to concatenation utility later)
- Frame extraction from videos (photobooth feature not needed here)
- Configurable orbit step count (fixed at 4 steps / 90° increments)
- Partial orbits (e.g., 180° sweep) — future enhancement

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────┐
│                  orbit_video tool                │
│  (defines 3-step pipeline config)               │
│                                                 │
│  Step 1: change_angle × 4                       │
│  Step 2: animate_photo × 4 (frameRole: "both")  │
│  Step 3: concatenateVideos()                    │
└──────────────────┬──────────────────────────────┘
                   │ uses
                   ▼
┌──────────────────────────────────────┐
│         ToolPipeline                 │
│  src/tools/shared/pipeline.ts        │
│                                      │
│  - Iterates steps sequentially       │
│  - Executes sub-tools via registry   │
│  - Maps sub-tool progress → phased   │
│    progress for parent tool          │
│  - Flows state between steps         │
└──────────────────┬───────────────────┘
                   │ calls
                   ▼
┌──────────────────────────────────────┐
│       toolRegistry.execute()         │
│  (existing — no changes)             │
└──────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│              stitch_video tool                   │
│  (standalone — does NOT use pipeline)            │
│                                                 │
│  Takes video result indices                     │
│  Calls concatenateVideos() directly             │
└──────────────────┬──────────────────────────────┘
                   │ uses
                   ▼
┌──────────────────────────────────────┐
│      concatenateVideos()             │
│  src/utils/videoConcatenation.ts     │
│                                      │
│  Ported from sogni-photobooth        │
│  Uses mp4box for lossless MP4        │
│  container manipulation              │
└──────────────────────────────────────┘
```

---

## 1. Video Concatenation Utility

**File:** `src/utils/videoConcatenation.ts`

**Source:** Ported from `sogni-photobooth/src/utils/videoConcatenation.js`

### What Gets Ported

- Core `concatenateMP4s_WithEditList()` — lossless MP4 atom manipulation (stts, stco, stsc, stsz, stss, ctts, edts)
- `extractVideoTrackWithSamples()` and `extractAudioTrackWithSamples()`
- S3 rate-limited download helper (150ms delay between requests)
- Progress callback support

### What Gets Left Behind

- Audio muxing/looping (not needed for orbit; add later)
- Frame extraction (photobooth uses this for transition preview thumbnails)
- MP3→M4A transcoding

### Public API

```typescript
/**
 * Concatenate multiple MP4 video files into a single continuous video.
 *
 * Uses mp4box for lossless container manipulation — no re-encoding.
 * Handles H.264 B-frames (ctts), edit lists (edts) for iOS/QuickTime
 * compatibility, and proper chunk offset recalculation.
 *
 * @param videoUrls - Array of video URLs to concatenate in order
 * @param onProgress - Optional progress callback (0-1)
 * @returns Blob containing the concatenated MP4
 */
export async function concatenateVideos(
  videoUrls: string[],
  onProgress?: (progress: number) => void,
): Promise<Blob>
```

### Dependency

Add `mp4box` to `package.json` dependencies.

---

## 2. ToolPipeline Abstraction

**File:** `src/tools/shared/pipeline.ts`

A lightweight, well-documented framework for chaining tool executions with intermediate state and phased progress reporting. Designed as a reusable foundation for future multi-step composite tools.

### Core Interfaces

```typescript
/**
 * Accumulated state that flows between pipeline steps.
 * Each step's collectResults() updates this state so subsequent steps
 * can reference outputs from prior steps.
 */
interface PipelineState {
  /** Image URLs accumulated across steps */
  imageUrls: string[];
  /** Video URLs accumulated across steps */
  videoUrls: string[];
  /** Arbitrary data passed between steps (e.g., stitchedUrl, dimensions) */
  data: Record<string, unknown>;
}

/**
 * Result from a single tool invocation within a pipeline step.
 */
interface StepResult {
  /** Raw JSON string returned by the tool handler */
  rawResult: string;
  /** Image URLs produced by this invocation */
  imageUrls: string[];
  /** Video URLs produced by this invocation */
  videoUrls: string[];
}

/**
 * Describes a single step in a pipeline.
 *
 * A step executes a tool N times (sequentially), collects results,
 * and updates pipeline state for the next step.
 */
interface PipelineStep {
  /** Human-readable label shown in stepLabel during progress
   *  (e.g., "Generating angle views") */
  label: string;

  /** Tool name to execute via toolRegistry.execute().
   *  Set to null for steps that run custom logic (e.g., stitching). */
  toolName: ToolName | null;

  /** Number of sequential invocations for this step */
  count: number;

  /** Derive tool args for the i-th invocation from current pipeline state.
   *  Called once per invocation. */
  buildArgs: (state: PipelineState, index: number) => Record<string, unknown>;

  /** Optional custom execution function for non-tool steps (e.g., stitching).
   *  If provided, toolName is ignored and this function runs instead. */
  customExecute?: (
    state: PipelineState,
    context: ToolExecutionContext,
    callbacks: ToolCallbacks,
  ) => Promise<StepResult[]>;

  /** Update pipeline state after all invocations in this step complete.
   *  Receives current state + results from each invocation. */
  collectResults: (state: PipelineState, results: StepResult[]) => PipelineState;
}

/**
 * Configuration for a complete pipeline.
 */
interface PipelineConfig {
  /** Ordered list of steps to execute */
  steps: PipelineStep[];
  /** Initial state before any steps run */
  initialState: PipelineState;
}
```

### Execution Flow

```
executePipeline(config, context, callbacks)
  │
  for each step in config.steps:
  │
  ├─ Update stepLabel → "{step.label}"
  │
  ├─ if step.customExecute:
  │     results = await step.customExecute(state, context, callbacks)
  │     (count is ignored — customExecute controls its own iteration)
  │
  ├─ else for i in 0..step.count:
  │   │
  │   ├─ args = step.buildArgs(state, i)
  │   │
  │   ├─ else:
  │   │     result = await toolRegistry.execute(step.toolName, args, context, wrappedCallbacks)
  │   │
  │   │   wrappedCallbacks intercepts sub-tool callbacks and re-emits
  │   │   as phased progress:
  │   │     - stepLabel: "{step.label} {i+1}/{step.count}"
  │   │     - progress: scoped to current step
  │   │     - perJobProgress: per-invocation slots within step
  │   │     - resultUrls/videoResultUrls: accumulated across step
  │   │
  │   └─ collect result (imageUrls, videoUrls, rawResult)
  │
  ├─ state = step.collectResults(state, stepResults)
  │
  └─ continue to next step
  │
  return state
```

### Progress Mapping

The pipeline intercepts sub-tool callbacks via `wrappedCallbacks` and re-maps them for the parent tool:

- **stepLabel** — Set to `"{step.label} {i+1}/{step.count}"` (e.g., "Generating angle views 2/4")
- **progress** — Scoped to the current step. The pipeline does NOT attempt to compute a single 0-1 value across all steps because step durations are unpredictable.
- **perJobProgress** — Each invocation within a step gets its own slot, showing per-slot progress, ETA, and result URLs as they arrive
- **resultUrls / videoResultUrls** — Accumulated as sub-tools complete, so the grid shows results appearing progressively

### Design Decisions

- **Steps are sequential** — one step must fully complete before the next begins (angles must exist before transitions can reference them)
- **Invocations within a step are sequential** — one SDK job at a time to avoid overwhelming the backend
- **Timeout chain** — the pipeline's parent tool (e.g., `orbit_video`) is invoked via `toolRegistry.execute()` with its own timeout. Sub-tool calls also go through `toolRegistry.execute()`, which replaces `context.signal` with a per-tool timeout signal (restored in `finally`). This works correctly for sequential calls. The parent tool's timeout resets whenever `onToolProgress` fires via `activityCallbacks`. Since `wrappedCallbacks` re-emit sub-tool progress to the parent's callbacks, the parent's inactivity timer stays alive as long as sub-tools are making progress. The parent tool must have a generous `TIMEOUT_OVERRIDES` entry (see Section 5).
- **Pipeline does NOT replace toolRegistry.execute()** — it wraps it
- **Pipeline state is a plain object** — easy to inspect and debug, no class hierarchy
- **Each step's collectResults is responsible for mapping outputs to state** — no magic inference
- **customExecute enables non-tool steps** — e.g., the stitch step calls concatenateVideos() directly instead of going through the registry
- **customExecute bypasses the count loop** — when `customExecute` is provided, `count` is ignored and `customExecute` is called exactly once (it returns its own `StepResult[]`)

---

## 3. `stitch_video` Tool

**Directory:** `src/tools/stitch-video/`

A standalone tool for general-purpose video concatenation. Does NOT use the pipeline — it's a simple single-step tool.

### Definition

```typescript
{
  name: 'stitch_video',
  description:
    'Combine multiple video results into a single continuous video. ' +
    'Use when the user wants to join, merge, or concatenate previously ' +
    'generated video clips into one video. Requires at least 2 video results.',
  parameters: {
    type: 'object',
    properties: {
      videoIndices: {
        type: 'array',
        items: { type: 'number' },
        description:
          'Array of 0-based video result indices to stitch together, ' +
          'in the desired playback order. References videos from previous ' +
          'tool results in this conversation.',
      },
    },
    required: ['videoIndices'],
  },
}
```

### Handler Flow

1. Resolve `videoIndices` against `context.videoResultUrls`. Defensively coerce array items to numbers (`(args.videoIndices as unknown[]).map(Number)`) since the registry's `validateArgs` does not recurse into array items — the LLM may send strings. Reject any `NaN` values.
2. Validate: at least 2 valid video URLs exist at the given indices
3. Report `onToolProgress({ type: 'started', stepLabel: 'Stitching videos', toolName: 'stitch_video' })`
4. Call `concatenateVideos(resolvedUrls, onProgress)` — progress mapped to `onToolProgress`
5. Save the resulting Blob to the gallery via `saveVideoToGallery()` (same as `animate_photo`). This persists the video to IndexedDB and returns a `galleryImageId`. Create an object URL from the Blob for immediate playback, and call `onGallerySaved` so the message gets the gallery ID for session-restore persistence.
6. Call `onToolComplete('stitch_video', [], [blobUrl])`
7. Return `JSON.stringify({ success: true, resultCount: 1, mediaType: 'video' })`

### Error Cases

- Missing or invalid indices → return error JSON explaining which indices are invalid
- Fewer than 2 valid videos → return error JSON
- Concatenation failure → return error JSON, no partial results

---

## 4. `orbit_video` Tool

**Directory:** `src/tools/orbit-video/`

A composite tool that uses the pipeline to generate a 360° orbit video. Fixed 4-step orbit at 90° increments.

### Definition

```typescript
{
  name: 'orbit_video',
  description:
    'Create a 360-degree orbit video around a subject by generating multiple ' +
    'camera angles and animating transitions between them. Produces a seamless ' +
    'looping video that pans around the subject. Use when the user asks for a ' +
    '"360 pan", "orbit", "rotate around", "spin around", or "turntable" view.',
  parameters: {
    type: 'object',
    properties: {
      elevation: {
        type: 'string',
        enum: ['low-angle shot', 'eye-level shot', 'elevated shot', 'high-angle shot'],
        description: 'Camera elevation for all angles. Default: "eye-level shot".',
      },
      distance: {
        type: 'string',
        enum: ['close-up', 'medium shot', 'wide shot'],
        description: 'Camera distance for all angles. Default: "medium shot".',
      },
      prompt: {
        type: 'string',
        description:
          'Motion/animation description for transition clips. Describes how the ' +
          'camera moves between angles. Default: "smooth camera pan".',
      },
      sourceImageIndex: {
        type: 'number',
        description:
          'Which result image to orbit around (0-based). Omit to use latest ' +
          'result or original upload.',
      },
    },
    required: [],
  },
}
```

### Pipeline Configuration (3 Steps)

#### Step 1: Generate Angle Views (4 invocations of `change_angle`)

Fixed azimuth sequence at the specified elevation and distance:

| Invocation | Azimuth | Description String |
|---|---|---|
| 0 | 0° | `"front view {elevation} {distance}"` |
| 1 | 90° | `"right side view {elevation} {distance}"` |
| 2 | 180° | `"back view {elevation} {distance}"` |
| 3 | 270° | `"left side view {elevation} {distance}"` |

- `buildArgs`: returns `{ description: angleString, sourceImageIndex }` for each invocation. The description string is constructed by concatenating the azimuth value, elevation, and distance with single spaces: e.g., `"front view eye-level shot medium shot"`. Defaults are applied before building: `elevation ?? 'eye-level shot'`, `distance ?? 'medium shot'`.
- `collectResults`: pushes 4 image URLs into `state.imageUrls`
- Progress grid: 4 slots showing angle images as they complete

#### Step 2: Generate Transition Clips (4 invocations of `animate_photo`)

Each clip interpolates between consecutive angle images using `frameRole: 'both'`:

| Invocation | Start Image | End Image | Transition |
|---|---|---|---|
| 0 | Front (index 0) | Right (index 1) | 0° → 90° |
| 1 | Right (index 1) | Back (index 2) | 90° → 180° |
| 2 | Back (index 2) | Left (index 3) | 180° → 270° |
| 3 | Left (index 3) | Front (index 0) | 270° → 360° (loop) |

- `buildArgs`: uses offset-adjusted indices to reference the correct angle images in `context.resultUrls`:
  ```typescript
  buildArgs: (state, i) => ({
    prompt,
    frameRole: 'both',
    sourceImageIndex: state.data.angleStartIndex + i,
    endImageIndex: state.data.angleStartIndex + ((i + 1) % 4),
    duration: 3,
  })
  ```
- `collectResults`: pushes 4 video URLs into `state.videoUrls`
- Progress grid: 4 slots showing video clips as they complete

**Critical: Index offset handling.** `context.resultUrls` is session-global — it contains all image results from the entire conversation, not just this tool's outputs. Step 1's `collectResults` must record `state.data.angleStartIndex = context.resultUrls.length` (captured *before* Step 1 runs) so Step 2's `buildArgs` can compute the correct absolute indices. The pipeline captures this offset in `initialState.data.angleStartIndex` before execution begins.

#### Step 3: Stitch (custom execution, no tool call)

- `customExecute`: calls `concatenateVideos(state.videoUrls)` directly, then saves the resulting Blob via `saveVideoToGallery()` for IndexedDB persistence (same pattern as `animate_photo`). Creates an object URL from the Blob for immediate playback.
- Progress: single slot showing "Stitching final video" with concatenation progress
- `collectResults`: sets `state.data.stitchedUrl` (the object URL for playback)

### Final Result Presentation

After pipeline completes, the handler calls:

```typescript
callbacks.onToolComplete(
  'orbit_video',
  state.imageUrls,                                    // 4 angle images
  [state.data.stitchedUrl as string, ...state.videoUrls]  // stitched + 4 individual clips
);
```

This gives the user all results (option C): 4 angle images as image results, stitched video as primary video result, and 4 individual clips as secondary video results.

---

## 5. Context & Type Changes

### `src/tools/types.ts`

- Add `'stitch_video' | 'orbit_video'` to the `ToolName` union type
- Add `videoResultUrls: string[]` to `ToolExecutionContext` interface

### `src/hooks/useChat.ts`

Adding `videoResultUrls` to the execution context requires a new persistent ref, analogous to the existing `allResultUrlsRef` for images:

1. **Create `allVideoUrlsRef`** — a `useRef<string[]>([])` that accumulates video result URLs across the entire session, parallel to how `allResultUrlsRef` tracks image URLs
2. **Accumulate on tool completion** — when `onToolComplete` fires with video URLs, append them to `allVideoUrlsRef.current` (analogous to lines 892-896 for image URLs)
3. **Expose via getter** — add `get videoResultUrls() { return allVideoUrlsRef.current; }` to the execution context object
4. **Hydrate on session restore** — when loading a session from IndexedDB, iterate persisted messages and populate `allVideoUrlsRef` from each message's `videoResults` field (analogous to how `allResultUrlsRef` is hydrated from `imageResults`)
5. **Reset on session switch** — clear `allVideoUrlsRef.current = []` when changing sessions

### `src/tools/index.ts`

- Add `import './stitch-video'` and `import './orbit-video'` (triggers self-registration)

### `src/components/chat/ChatProgressIndicator.tsx`

- Add to `TOOL_LABELS`:
  - `orbit_video: 'Creating orbit video'`
  - `stitch_video: 'Stitching videos'`

### `src/tools/registry.ts`

- Add timeout overrides for the new tools:
  - `orbit_video: 1_800_000` (30 minutes — 4 angle generations + 4 video generations + stitching)
  - `stitch_video: 600_000` (10 minutes — large video concatenation can be slow)

### `package.json`

- Add `mp4box` dependency

### No Changes Needed

- `chatService.ts` — tool calling loop unchanged
- `ChatVideoResults.tsx` — already handles multiple video URLs
- `ChatMessage.tsx` — already renders video results

---

## 6. Error Handling & Credits

### Pre-flight Credit Check

`orbit_video` estimates total cost before starting:

```
totalCost = 4 × angleCost(effectiveTier) + 4 × videoCost(3 seconds)
```

**Important:** The angle cost estimate must use the effective quality tier, not the raw `context.qualityTier`. The `change_angle` handler forces `pro` → `hq` (SV3D is incompatible with Flux.2 pro tier). The orbit handler must apply the same fallback: `const effectiveTier = context.qualityTier === 'pro' ? 'hq' : (context.qualityTier || 'fast')`.

Single pre-flight check at the start. Individual steps still register per-job billing for accurate tracking.

### Error Cascade

| Failure Point | Behavior |
|---|---|
| Source image missing | Fail fast, return `no_image` error |
| `change_angle` invocation fails | Pipeline aborts. Any completed angle images remain in results. |
| `animate_photo` invocation fails | Pipeline aborts. Angle images + completed clips shown. |
| `concatenateVideos()` fails | Abort. All 4 angle images + all 4 individual clips still available. |
| Insufficient credits | Pre-flight fails before pipeline starts |

### Abort/Cancel

Pipeline respects `context.signal` (AbortSignal). If the user switches sessions mid-orbit, the pipeline stops after the current sub-tool invocation completes. Partial results are preserved.

---

## 7. Testing Strategy

### Unit Tests

- `concatenateVideos()` — test with mock MP4 blobs, verify output is valid MP4
- `ToolPipeline` — test with mock tool handlers:
  - Verify steps execute in order
  - Verify state flows between steps via collectResults
  - Verify progress callbacks are re-mapped with correct stepLabel and phase
  - Verify abort signal stops execution
  - Verify error in step N preserves results from steps 1..N-1

### Manual E2E

1. Upload image → "create a 360 orbit" → verify:
   - 4 angle images appear progressively in grid
   - 4 transition clips appear progressively in grid
   - Stitching phase shows progress
   - Final result shows all results (images + stitched video + individual clips)
   - Stitched video plays seamlessly
2. Generate 3+ videos via separate tool calls → "stitch these videos together" → verify stitched result
3. Test abort mid-orbit (switch sessions) → verify partial results preserved
4. Test insufficient credits → verify early failure with clear message
