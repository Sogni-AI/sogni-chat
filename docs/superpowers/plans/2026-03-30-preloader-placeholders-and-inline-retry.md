# Preloader Placeholders & Inline Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace gray-box loading states with blurry source-image placeholders everywhere context images are available, and add per-item inline regenerate buttons on both in-progress and completed artifacts so users can redo any single item in a batch without creating new chat entries.

**Architecture:** Two parallel workstreams: (A) Enrich progress data with source/context image URLs from tool handlers → render them as blurry placeholders in the UI components; (B) Extend the retryBus + progress/result data model with per-item regenerate keys → render redo buttons on every slot (pending, completed, failed). Inspired by sogni-photobooth's VideoReviewPopup — redo button on every card, version cycling on completed items — but adapted for inline chat rendering.

**Tech Stack:** React 18, TypeScript, Vite, existing retryBus service, inline styles (matching existing codebase conventions)

---

## File Map

### Modified Files

| File | Responsibility |
|------|---------------|
| `src/tools/types.ts` | Add `contextImageUrls` and `endFrameImageUrl` to `ToolExecutionProgress`; add `retryKey` to `perJobProgress` for completed slots |
| `src/tools/edit-image/handler.ts` | Emit `sourceImageUrl` + `contextImageUrls` in progress callbacks |
| `src/tools/restore-photo/handler.ts` | Emit `sourceImageUrl` (uploaded image data URI) in progress callbacks |
| `src/tools/generate-image/handler.ts` | Emit `sourceImageUrl` when `startingImageStrength > 0` (img2img mode); emit per-job `retryKey` on completion |
| `src/tools/generate-video/handler.ts` | Emit per-job `retryKey` on video completion |
| `src/tools/animate-photo/handler.ts` | Emit `endFrameImageUrl` when `frameRole === 'both'`; emit per-job `retryKey` on completion |
| `src/tools/change-angle/handler.ts` | Emit per-job `retryKey` on completion |
| `src/tools/video-to-video/handler.ts` | Emit `sourceImageUrl` (the source video's first frame); emit per-job `retryKey` |
| `src/components/chat/ChatProgressIndicator.tsx` | Render dual-image blurry placeholder when `contextImageUrls` has 2+ entries; render first-frame/last-frame placeholder for video tools |
| `src/components/chat/ChatVideoResults.tsx` | Show blurry first-frame placeholder on pending video slots; add redo button to completed and failed video slots |
| `src/components/chat/ChatImageResults.tsx` | Add redo button overlay on each completed image result |
| `src/components/chat/ChatMessage.tsx` | Wire `onItemRetry` callback through to result components |
| `src/hooks/useChat.ts` | Add `handleItemRetry(messageId, jobIndex)` that re-executes a single tool job inline, replacing the result at that index |
| `src/services/retryBus.ts` | No changes needed — existing `onRetry`/`triggerRetry` is sufficient |
| `src/types/chat.ts` | Add `toolName` and per-item retry metadata to `UIChatMessage` for post-completion retries |

---

## Task 1: Extend ToolExecutionProgress with context image fields

**Files:**
- Modify: `src/tools/types.ts:102-142`

This task adds fields that tool handlers will use to pass context image URLs (for blurry placeholders) and per-item retry keys (for inline redo) to the UI.

- [ ] **Step 1: Add `contextImageUrls` and `endFrameImageUrl` fields to `ToolExecutionProgress`**

In `src/tools/types.ts`, add these fields after `sourceImageUrl` (line 118):

```typescript
  /** URL of the source image being processed (for placeholder display) */
  sourceImageUrl?: string;
  /** URLs of additional context images used (for multi-image placeholder display, e.g. persona + source) */
  contextImageUrls?: string[];
  /** URL of the end-frame image when frameRole is "both" (for dual-frame video placeholder) */
  endFrameImageUrl?: string;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (fields are optional, so all existing callsites remain valid)

- [ ] **Step 3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat: add contextImageUrls and endFrameImageUrl to ToolExecutionProgress"
```

---

## Task 2: Emit sourceImageUrl from edit-image and restore-photo handlers

**Files:**
- Modify: `src/tools/edit-image/handler.ts:219-225`
- Modify: `src/tools/restore-photo/handler.ts:62-68`

These two tools currently show gray boxes because they don't emit `sourceImageUrl`. The edit-image handler has context images available; restore-photo works on the uploaded image.

- [ ] **Step 1: Add sourceImageUrl to edit-image handler**

In `src/tools/edit-image/handler.ts`, after the `estimatedCost` computation (around line 217), create a data URI from the first context image for the placeholder, then pass it in the `started` callback.

Before the `callbacks.onToolProgress({ type: 'started', ... })` call (line 219), add:

```typescript
  // Build placeholder URL for blurred progress display
  const firstContextImage = cappedContextImages[0];
  const sourceImageUrl = firstContextImage
    ? `data:${firstContextImage.mimeType};base64,${btoa(String.fromCharCode(...firstContextImage.data.slice(0, 50000)))}`
    : undefined;

  // Build context image URLs for multi-image placeholder (e.g. persona + reference)
  const contextImageUrls = cappedContextImages.length > 1
    ? cappedContextImages.slice(0, 3).map(img =>
        `data:${img.mimeType};base64,${btoa(String.fromCharCode(...img.data.slice(0, 50000)))}`
      )
    : undefined;
```

**IMPORTANT:** The above approach won't scale for large images. Instead, use the existing `uint8ArrayToDataUri` utility from shared:

```typescript
  import { uint8ArrayToDataUri } from '../shared/imageEncoding';
```

Then before the started callback:

```typescript
  // Build placeholder URLs for blurred progress display from context images
  const sourceImageUrl = cappedContextImages.length > 0
    ? await uint8ArrayToDataUri(cappedContextImages[0].data, cappedContextImages[0].mimeType)
    : undefined;
  const contextImageUrls = cappedContextImages.length > 1
    ? await Promise.all(
        cappedContextImages.slice(0, 3).map(img => uint8ArrayToDataUri(img.data, img.mimeType))
      )
    : undefined;
```

Update the started callback to include both fields:

```typescript
  callbacks.onToolProgress({
    type: 'started',
    toolName: 'edit_image',
    totalCount: numberOfMedia,
    estimatedCost,
    modelName: `${modelConfig.name} — ${outputWidth}x${outputHeight}`,
    sourceImageUrl,
    contextImageUrls,
  });
```

Also add `sourceImageUrl` to the ongoing progress callback (around line 280):

```typescript
            callbacks.onToolProgress({
              type: progress.type === 'completed' ? 'completed' : 'progress',
              toolName: 'edit_image',
              progress: progress.progress,
              completedCount: progress.completedCount,
              totalCount: numberOfMedia,
              jobIndex: progress.jobIndex,
              etaSeconds: progress.etaSeconds,
              resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
              estimatedCost,
              sourceImageUrl,
            });
```

- [ ] **Step 2: Add sourceImageUrl to restore-photo handler**

In `src/tools/restore-photo/handler.ts`, before the started callback (line 62), create a data URI from the uploaded image:

```typescript
  import { uint8ArrayToDataUri } from '../shared/imageEncoding';
```

Before the started callback:

```typescript
  // Build placeholder URL for blurred progress display from uploaded image
  const sourceImageUrl = context.imageData
    ? await uint8ArrayToDataUri(context.imageData, 'image/jpeg')
    : undefined;
```

Update the started callback:

```typescript
  callbacks.onToolProgress({
    type: 'started',
    toolName: 'restore_photo',
    totalCount: numberOfMedia,
    estimatedCost,
    modelName: `${modelOverride?.name ?? `Qwen Image Edit 2511${qualityTier === 'fast' ? ' Lightning' : ''}`} — ${outputWidth}x${outputHeight}`,
    sourceImageUrl,
  });
```

Also add `sourceImageUrl` to the ongoing progress callback:

```typescript
            callbacks.onToolProgress({
              type: progress.type === 'completed' ? 'completed' : 'progress',
              toolName: 'restore_photo',
              progress: progress.progress,
              completedCount: progress.completedCount,
              totalCount: progress.totalCount,
              jobIndex: progress.jobIndex,
              etaSeconds: progress.etaSeconds,
              resultUrls: progress.resultUrl ? [progress.resultUrl] : undefined,
              estimatedCost,
              sourceImageUrl,
            });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/edit-image/handler.ts src/tools/restore-photo/handler.ts
git commit -m "feat: emit sourceImageUrl from edit-image and restore-photo handlers"
```

---

## Task 3: Emit endFrameImageUrl from animate-photo handler

**Files:**
- Modify: `src/tools/animate-photo/handler.ts:355-370`

When `frameRole === 'both'`, the user has specified both a start frame and an end frame. The end frame URL should be passed to the UI so the video placeholder can show both frames.

- [ ] **Step 1: Resolve end frame URL and pass it in progress callbacks**

In `src/tools/animate-photo/handler.ts`, after the `sourceImageUrl` is resolved (line 355), add end frame URL resolution:

```typescript
  const sourceImageUrl = (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) || undefined;

  // Resolve end frame URL for dual-frame placeholder (when frameRole is "both")
  let endFrameImageUrl: string | undefined;
  if (frameRole === 'both' && endImageData) {
    // Try to get URL from results array if endImageIndex was specified
    if (rawEndImageIndex !== undefined && rawEndImageIndex >= 0 && context.resultUrls[rawEndImageIndex]) {
      endFrameImageUrl = context.resultUrls[rawEndImageIndex];
    } else if (rawEndImageIndex === -1) {
      // Using original uploaded image as end frame — convert to data URI
      endFrameImageUrl = sourceImageUrl; // Will be the uploaded image URL
    }
  }
```

Update the started callback (line 357) to include `endFrameImageUrl`:

```typescript
  callbacks.onToolProgress({
    type: 'started',
    toolName: 'animate_photo',
    totalCount: numberOfMedia,
    estimatedCost,
    sourceImageUrl,
    endFrameImageUrl,
    stepLabel: 'Generating video',
    videoAspectRatio,
    modelName: mediaLabel,
  });
```

Also add `endFrameImageUrl` to all subsequent progress callbacks in the handler that already include `sourceImageUrl` (lines 442, 468, 484, 517).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/animate-photo/handler.ts
git commit -m "feat: emit endFrameImageUrl from animate-photo for dual-frame video placeholder"
```

---

## Task 4: Add contextImageUrls and endFrameImageUrl to progress merging in useChat

**Files:**
- Modify: `src/hooks/useChat.ts` (progress merging section, around lines 747-829)

The useChat hook merges progress events into `UIChatMessage.toolProgress`. The new fields need to be preserved across merges.

- [ ] **Step 1: Add field preservation in the progress merge logic**

In the `onToolProgress` callback in `useChat.ts`, find the merged progress object construction (the section that does `...prev, ...progress` with field-by-field fallbacks). Add:

```typescript
  const merged: ToolExecutionProgress = progress.type === 'started'
    ? { ...progress, perJobProgress, referencedPersonas: progress.referencedPersonas ?? prev?.referencedPersonas }
    : {
        ...prev,
        ...progress,
        progress: progress.progress ?? prev?.progress,
        etaSeconds: progress.etaSeconds ?? prev?.etaSeconds,
        estimatedCost: progress.estimatedCost ?? prev?.estimatedCost,
        sourceImageUrl: progress.sourceImageUrl ?? prev?.sourceImageUrl,
        contextImageUrls: progress.contextImageUrls ?? prev?.contextImageUrls,
        endFrameImageUrl: progress.endFrameImageUrl ?? prev?.endFrameImageUrl,
        videoAspectRatio: progress.videoAspectRatio ?? prev?.videoAspectRatio,
        modelName: progress.modelName ?? prev?.modelName,
        referencedPersonas: progress.referencedPersonas ?? prev?.referencedPersonas,
        resultUrls: progress.resultUrls
          ? [...new Set([...(prev?.resultUrls || []), ...progress.resultUrls])]
          : prev?.resultUrls,
        perJobProgress,
      };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: preserve contextImageUrls and endFrameImageUrl in progress merging"
```

---

## Task 5: Render blurry context image placeholders in ChatProgressIndicator

**Files:**
- Modify: `src/components/chat/ChatProgressIndicator.tsx:390-490`

Currently, the progress grid shows a single blurred `placeholderUrl` image per slot. When `contextImageUrls` has 2+ entries (e.g. persona photo + source image), show a split-screen blurred placeholder. When `endFrameImageUrl` is set, show start → end frame with a divider.

- [ ] **Step 1: Extract contextImageUrls and endFrameImageUrl from progress**

In the `ChatProgressIndicator` component, after the existing `placeholderUrl` derivation (line 390):

```typescript
  const placeholderUrl = progress.sourceImageUrl || imageUrl;
  const contextImageUrls = progress.contextImageUrls;
  const endFrameImageUrl = progress.endFrameImageUrl;
  // Determine placeholder mode
  const hasDualPlaceholder = (contextImageUrls && contextImageUrls.length >= 2) || !!endFrameImageUrl;
```

- [ ] **Step 2: Add dual-image placeholder rendering**

Inside the grid slot rendering (the `Array.from({ length: totalCount }, ...)` block), replace the single placeholder `<img>` with conditional rendering. Find the existing block (around lines 464-489) that renders:

```typescript
) : resultUrl || placeholderUrl ? (
  <img src={resultUrl || placeholderUrl!} ... />
) : (
```

Replace the placeholder portion with:

```typescript
) : resultUrl ? (
  <img
    src={resultUrl}
    alt={`Result #${i + 1}`}
    style={{
      width: '100%',
      height: 'auto',
      display: 'block',
    }}
  />
) : hasDualPlaceholder ? (
  /* Split-screen blurred placeholder: two context images side by side */
  <div
    style={{
      position: 'relative',
      width: '100%',
      aspectRatio: progress.videoAspectRatio || '16 / 9',
      display: 'flex',
      overflow: 'hidden',
    }}
  >
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <img
        src={endFrameImageUrl ? placeholderUrl! : contextImageUrls![0]}
        alt=""
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'blur(8px) brightness(0.7)',
          transform: 'scale(1.1)',
        }}
      />
    </div>
    {/* Center divider with arrow */}
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.5rem',
        height: '1.5rem',
        borderRadius: '50%',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </div>
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <img
        src={endFrameImageUrl || contextImageUrls![1]}
        alt=""
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'blur(8px) brightness(0.7)',
          transform: 'scale(1.1)',
        }}
      />
    </div>
  </div>
) : placeholderUrl ? (
  <img
    src={placeholderUrl}
    alt="Processing..."
    style={{
      width: '100%',
      display: 'block',
      filter: 'blur(8px) brightness(0.7)',
      transform: 'scale(1.05)',
      transition: 'filter 0.5s ease, transform 0.5s ease',
      ...(isVideoTool && progress.videoAspectRatio
        ? { aspectRatio: progress.videoAspectRatio, height: 'auto', objectFit: 'cover' as const }
        : { height: 'auto' }),
    }}
  />
) : (
```

- [ ] **Step 3: Verify TypeScript compiles and visually inspect**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatProgressIndicator.tsx
git commit -m "feat: render dual-image blurry placeholder for multi-context and dual-frame tools"
```

---

## Task 6: Show blurry first-frame placeholder on pending video slots

**Files:**
- Modify: `src/components/chat/ChatVideoResults.tsx:759-812`

Currently, pending video slots show a gray box with spinner. When the parent message has a `sourceImageUrl` (from `animate_photo`, `video_to_video`), show that image blurred as the background of the pending slot.

- [ ] **Step 1: Add sourceImageUrl and endFrameImageUrl props to ChatVideoResults**

```typescript
interface ChatVideoResultsProps {
  urls: string[];
  galleryVideoIds?: string[];
  videoAspectRatio?: string;
  autoPlay?: boolean;
  onActiveIndexChange?: (index: number) => void;
  onVideoClick?: (url: string, index: number) => void;
  totalCount?: number;
  perJobProgress?: Record<number, {
    progress?: number;
    etaSeconds?: number;
    resultUrl?: string;
    error?: string;
    label?: string;
    retryKey?: string;
  }>;
  /** Source image URL for blurred placeholder on pending video slots */
  sourceImageUrl?: string;
  /** End-frame image URL for dual-frame placeholder on pending video slots */
  endFrameImageUrl?: string;
}
```

- [ ] **Step 2: Replace gray pending slot background with blurry source image**

In the `isPending` branch (line 759-812), add a blurred image background:

```typescript
) : isPending ? (
  /* Loading placeholder for pending video slot */
  <div
    style={{
      position: 'relative',
      width: '100%',
      aspectRatio: videoAspectRatio || '16 / 9',
      background: 'rgba(var(--rgb-primary), 0.06)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.5rem',
      overflow: 'hidden',
    }}
  >
    {/* Blurred source image as background placeholder */}
    {sourceImageUrl && (
      endFrameImageUrl ? (
        /* Dual-frame: start + end side by side */
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <img src={sourceImageUrl} alt="" aria-hidden="true"
            style={{ flex: 1, objectFit: 'cover', filter: 'blur(8px) brightness(0.6)', transform: 'scale(1.1)' }} />
          <img src={endFrameImageUrl} alt="" aria-hidden="true"
            style={{ flex: 1, objectFit: 'cover', filter: 'blur(8px) brightness(0.6)', transform: 'scale(1.1)' }} />
        </div>
      ) : (
        <img src={sourceImageUrl} alt="" aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', filter: 'blur(8px) brightness(0.6)', transform: 'scale(1.1)',
          }} />
      )
    )}
    {/* Spinner and labels overlaid on top */}
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <div className="animate-spin" style={{
        width: '1.5rem', height: '1.5rem',
        border: sourceImageUrl ? '2.5px solid rgba(255,255,255,0.3)' : '2.5px solid var(--color-border)',
        borderTopColor: sourceImageUrl ? '#fff' : 'var(--color-accent)',
        borderRadius: '50%',
      }} />
      {jobData?.label && (
        <span style={{
          fontSize: '0.75rem', fontWeight: 500,
          color: sourceImageUrl ? '#fff' : 'var(--color-text-secondary)',
          textShadow: sourceImageUrl ? '0 1px 4px rgba(0,0,0,0.6)' : 'none',
        }}>
          {jobData.label}...
        </span>
      )}
      {jobProgressText && (
        <span style={{
          fontSize: '0.6875rem',
          color: sourceImageUrl ? 'rgba(255,255,255,0.85)' : 'var(--color-text-tertiary)',
          textShadow: sourceImageUrl ? '0 1px 4px rgba(0,0,0,0.6)' : 'none',
        }}>
          {jobProgressText}
        </span>
      )}
      {jobProg !== undefined && (
        <div style={{ width: '60%', height: '3px', background: sourceImageUrl ? 'rgba(255,255,255,0.2)' : 'rgba(var(--rgb-primary), 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${jobPct}%`, height: '100%', background: sourceImageUrl ? '#fff' : 'var(--color-accent)', borderRadius: '2px', transition: 'width 0.3s ease' }} />
        </div>
      )}
    </div>
  </div>
```

- [ ] **Step 3: Wire sourceImageUrl and endFrameImageUrl from ChatMessage**

In `src/components/chat/ChatMessage.tsx`, pass these props to `ChatVideoResults`:

```typescript
  <ChatVideoResults
    urls={message.videoResults || []}
    galleryVideoIds={message.galleryVideoIds}
    videoAspectRatio={message.videoAspectRatio || message.toolProgress?.videoAspectRatio}
    autoPlay={!message.isFromHistory}
    onVideoClick={onVideoClick}
    totalCount={message.toolProgress?.totalCount}
    perJobProgress={message.toolProgress?.perJobProgress}
    sourceImageUrl={message.toolProgress?.sourceImageUrl || message.sourceImageUrl || undefined}
    endFrameImageUrl={message.toolProgress?.endFrameImageUrl}
  />
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatVideoResults.tsx src/components/chat/ChatMessage.tsx
git commit -m "feat: show blurry source image placeholder on pending video slots"
```

---

## Task 7: Add per-item redo button to ChatProgressIndicator (in-progress artifacts)

**Files:**
- Modify: `src/components/chat/ChatProgressIndicator.tsx`

Add a redo (refresh) button to every slot in the progress grid — for completed results (user wants to try again), failed slots, and pending slots (option to restart). Inspired by sogni-photobooth's pill-shaped "redo" button.

- [ ] **Step 1: Add onItemRetry prop to ChatProgressIndicator**

```typescript
interface ChatProgressIndicatorProps {
  progress: ToolExecutionProgress;
  imageUrl?: string | null;
  onCancel?: () => void;
  onMediaClick?: (index: number, mediaType: 'image' | 'video' | 'audio') => void;
  hideVideoGrid?: boolean;
  /** Called when user clicks the redo button on a specific slot */
  onItemRetry?: (jobIndex: number) => void;
}
```

- [ ] **Step 2: Add redo button to completed and failed slots**

In the grid slot rendering, add a redo button in the top-right corner for completed results and in the center for failed results. The button should replace the current "Failed" overlay's static error icon with an actionable retry.

For **completed slots** (where `resultUrl` is truthy), add a small redo button overlay in the top-right:

```typescript
{/* Redo button on completed results */}
{resultUrl && onItemRetry && (
  <button
    onClick={(e) => { e.stopPropagation(); onItemRetry(i); }}
    title="Regenerate this result"
    style={{
      position: 'absolute',
      top: '0.375rem',
      right: '0.375rem',
      zIndex: 3,
      background: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      border: 'none',
      borderRadius: '50%',
      width: '1.75rem',
      height: '1.75rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      opacity: 0.8,
      transition: 'opacity 0.2s, transform 0.2s',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'scale(1)'; }}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  </button>
)}
```

For **failed slots** (where `jobError` is truthy), replace the static "Failed" text with an actionable redo button:

```typescript
{/* Overlay for failed jobs */}
{!resultUrl && jobError && (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'rgba(0, 0, 0, 0.6)' }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(239, 68, 68, 0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'rgba(239, 68, 68, 0.9)', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
      Failed
    </span>
    {onItemRetry && (
      <button
        onClick={(e) => { e.stopPropagation(); onItemRetry(i); }}
        style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          padding: '0.25rem 0.75rem',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.15)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          color: '#fff',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
      >
        Retry
      </button>
    )}
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatProgressIndicator.tsx
git commit -m "feat: add per-item redo button to progress grid (completed + failed slots)"
```

---

## Task 8: Add redo button to ChatImageResults (completed image artifacts)

**Files:**
- Modify: `src/components/chat/ChatImageResults.tsx`

Add a small circular redo button in the top-right corner of each completed image result card. This allows users to regenerate any individual image in a batch after the tool completes.

- [ ] **Step 1: Add onItemRetry prop to ChatImageResults**

```typescript
interface ChatImageResultsProps {
  urls: string[];
  sourceImageUrl?: string;
  onImageClick?: (url: string, index: number) => void;
  galleryImageIds?: string[];
  /** Called when user clicks the redo button on a specific result */
  onItemRetry?: (index: number) => void;
}
```

- [ ] **Step 2: Add redo button overlay to each image card**

Inside the `urls.map()` block, after the index badge `<div>` (line 193-211) and before the closing `</button>`, add:

```typescript
{/* Redo button — top-right, visible on hover or always on mobile */}
{onItemRetry && !isFailed && (
  <button
    onClick={(e) => { e.stopPropagation(); onItemRetry(index); }}
    title="Regenerate this image"
    style={{
      position: 'absolute',
      top: '0.375rem',
      right: '0.375rem',
      zIndex: 3,
      background: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      border: 'none',
      borderRadius: '50%',
      width: '1.75rem',
      height: '1.75rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      opacity: 0,
      transition: 'opacity 0.2s, transform 0.2s',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.transform = 'scale(1)'; }}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  </button>
)}
```

Also add to the parent `<button>` element's `onMouseEnter`/`onMouseLeave` handlers to show the redo button on card hover:

```typescript
onMouseEnter={(e) => {
  if (!isFailed) {
    e.currentTarget.style.borderColor = 'var(--color-accent)';
    e.currentTarget.style.transform = 'scale(1.02)';
    // Show redo button on hover
    const redoBtn = e.currentTarget.querySelector('[title="Regenerate this image"]') as HTMLElement;
    if (redoBtn) redoBtn.style.opacity = '1';
  }
}}
onMouseLeave={(e) => {
  e.currentTarget.style.borderColor = 'transparent';
  e.currentTarget.style.transform = 'scale(1)';
  const redoBtn = e.currentTarget.querySelector('[title="Regenerate this image"]') as HTMLElement;
  if (redoBtn) redoBtn.style.opacity = '0';
}}
```

For the failed state, add a retry button inside the error overlay (after "Image expired" span):

```typescript
{isFailed && onItemRetry && (
  <button
    onClick={(e) => { e.stopPropagation(); onItemRetry(index); }}
    style={{
      fontSize: '0.6875rem', fontWeight: 600,
      padding: '0.25rem 0.75rem', borderRadius: '12px',
      background: 'var(--color-accent)', color: 'white',
      border: 'none', cursor: 'pointer',
      marginTop: '0.25rem',
    }}
  >
    Retry
  </button>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatImageResults.tsx
git commit -m "feat: add per-image redo button to completed image results"
```

---

## Task 9: Add redo button to ChatVideoResults (completed + failed video slots)

**Files:**
- Modify: `src/components/chat/ChatVideoResults.tsx`

Add a redo button to completed video thumbnail cards and update the existing failed-state retry button to also work post-completion.

- [ ] **Step 1: Add onItemRetry prop to ChatVideoResults**

```typescript
interface ChatVideoResultsProps {
  // ... existing props ...
  /** Called when user clicks the redo button on a specific video slot */
  onItemRetry?: (index: number) => void;
}
```

- [ ] **Step 2: Add redo button to completed video thumbnail cards**

In the grid mode branch (`isGrid ? (` block, around line 813), wrap the `VideoThumbnailCard` with a relative container and add a redo button overlay:

```typescript
) : isGrid ? (
  /* Grid mode — thumbnail card with play overlay */
  <div style={{ position: 'relative' }}>
    <VideoThumbnailCard
      src={displayUrl}
      aspectRatio={videoAspectRatio}
      onClick={() => {
        onActiveIndexChange?.(index);
        onVideoClick?.(displayUrl, index);
      }}
      onError={() => handleError(index)}
    />
    {/* Redo button on completed video thumbnails */}
    {onItemRetry && (
      <button
        onClick={(e) => { e.stopPropagation(); onItemRetry(index); }}
        title="Regenerate this video"
        style={{
          position: 'absolute',
          top: '0.375rem',
          right: '0.375rem',
          zIndex: 4,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          border: 'none',
          borderRadius: '50%',
          width: '1.75rem',
          height: '1.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0,
          transition: 'opacity 0.2s, transform 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 4v6h6" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
    )}
  </div>
```

The outer slot `<div>` should have `onMouseEnter`/`onMouseLeave` to show the redo button on hover (same pattern as image results).

For the **failed state** (line 712-758), update to always include a retry button:

```typescript
{onItemRetry ? (
  <button
    onClick={() => onItemRetry(index)}
    style={{
      fontSize: '0.75rem', fontWeight: 600,
      padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-sm)',
      background: 'var(--color-accent)', color: 'white',
      border: 'none', cursor: 'pointer',
    }}
  >
    Retry clip
  </button>
) : jobData?.retryKey ? (
  <button onClick={() => triggerRetry(jobData.retryKey!)} ...>
    Retry clip
  </button>
) : (
  <span ...>Video expired</span>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatVideoResults.tsx
git commit -m "feat: add per-video redo button to completed and failed video slots"
```

---

## Task 10: Add handleItemRetry to useChat hook and wire through ChatMessage

**Files:**
- Modify: `src/hooks/useChat.ts`
- Modify: `src/components/chat/ChatMessage.tsx`
- Modify: `src/types/chat.ts`

This is the core logic: when a user clicks redo on a specific slot, re-execute the same tool with the same args for a single item, and replace the result at that index in-place.

- [ ] **Step 1: Add toolName to UIChatMessage for post-completion retry**

In `src/types/chat.ts`, the field `lastCompletedTool` already exists. We'll use that along with `toolArgs` (already present) to re-execute.

- [ ] **Step 2: Implement handleItemRetry in useChat**

In `src/hooks/useChat.ts`, add a new function that:
1. Finds the message by ID
2. Reads `lastCompletedTool` and `toolArgs` from the message
3. Creates a new tool execution context (same as original)
4. Executes the tool with `numberOfVariations: 1`
5. On completion, replaces `imageResults[jobIndex]` or `videoResults[jobIndex]` with the new URL
6. Updates gallery IDs if applicable

```typescript
const handleItemRetry = useCallback(async (messageId: string, jobIndex: number) => {
  const message = uiMessages.find(m => m.id === messageId);
  if (!message?.lastCompletedTool || !message.toolArgs) return;

  const toolName = message.lastCompletedTool as ToolName;
  const originalArgs = { ...message.toolArgs };

  // Force single variation for inline retry
  originalArgs.numberOfVariations = 1;

  // Mark the slot as regenerating in progress
  setUIMessages(prev => prev.map(msg => {
    if (msg.id !== messageId) return msg;
    return {
      ...msg,
      toolProgress: {
        type: 'progress' as const,
        toolName,
        totalCount: msg.imageResults?.length || msg.videoResults?.length || 1,
        perJobProgress: {
          [jobIndex]: { progress: 0, label: 'Regenerating...' },
        },
      },
    };
  }));

  try {
    // Execute tool for single item
    const context = buildExecutionContext(); // Use existing context builder
    const result = await toolRegistry.execute(toolName, originalArgs, context, {
      onToolProgress: (progress) => {
        setUIMessages(prev => prev.map(msg => {
          if (msg.id !== messageId) return msg;
          const prevProgress = msg.toolProgress;
          return {
            ...msg,
            toolProgress: {
              ...prevProgress,
              type: 'progress' as const,
              toolName,
              perJobProgress: {
                ...prevProgress?.perJobProgress,
                [jobIndex]: {
                  progress: progress.progress,
                  etaSeconds: progress.etaSeconds,
                  label: 'Regenerating...',
                },
              },
            },
          };
        }));
      },
      onToolComplete: (_toolName, resultUrls, videoResultUrls) => {
        setUIMessages(prev => prev.map(msg => {
          if (msg.id !== messageId) return msg;
          const newImageResults = msg.imageResults ? [...msg.imageResults] : [];
          const newVideoResults = msg.videoResults ? [...msg.videoResults] : [];

          if (videoResultUrls?.[0]) {
            newVideoResults[jobIndex] = videoResultUrls[0];
          } else if (resultUrls?.[0]) {
            newImageResults[jobIndex] = resultUrls[0];
          }

          return {
            ...msg,
            toolProgress: null,
            imageResults: newImageResults.length > 0 ? newImageResults : msg.imageResults,
            videoResults: newVideoResults.length > 0 ? newVideoResults : msg.videoResults,
          };
        }));
      },
    });
  } catch (err) {
    // Clear progress on error
    setUIMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg;
      return { ...msg, toolProgress: null };
    }));
    console.error('[CHAT] Inline retry failed:', err);
  }
}, [uiMessages, /* other deps */]);
```

**Note:** The above is a simplified sketch. The actual implementation must:
- Reuse the same `buildExecutionContext` pattern from `sendMessage`
- Handle the tool execution context properly (sogniClient, tokenType, etc.)
- Save the new result to gallery (call `onGallerySaved`)
- Update gallery IDs at the correct index
- Handle abort signals properly

- [ ] **Step 3: Add onItemRetry prop to ChatMessage and wire through**

In `src/components/chat/ChatMessage.tsx`, add the prop:

```typescript
interface ChatMessageProps {
  // ... existing ...
  /** Called when user clicks redo on a specific result slot */
  onItemRetry?: (messageId: string, jobIndex: number) => void;
}
```

Wire it to each result component:

```typescript
<ChatImageResults
  urls={message.imageResults}
  sourceImageUrl={message.sourceImageUrl || imageUrl || undefined}
  onImageClick={onImageClick}
  galleryImageIds={message.galleryImageIds}
  onItemRetry={onItemRetry ? (index) => onItemRetry(message.id, index) : undefined}
/>

<ChatVideoResults
  urls={message.videoResults || []}
  // ... existing props ...
  onItemRetry={onItemRetry ? (index) => onItemRetry(message.id, index) : undefined}
/>

<ChatProgressIndicator
  progress={message.toolProgress}
  imageUrl={imageUrl}
  onCancel={onCancelTool}
  onMediaClick={onProgressMediaClick}
  onItemRetry={onItemRetry ? (index) => onItemRetry(message.id, index) : undefined}
/>
```

- [ ] **Step 4: Wire handleItemRetry from ChatPanel through ChatMessage**

In `src/pages/ChatPage.tsx` or wherever `ChatMessage` is rendered (likely in `ChatPanel`), pass the handler:

```typescript
<ChatMessage
  message={msg}
  // ... existing props ...
  onItemRetry={handleItemRetry}
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useChat.ts src/components/chat/ChatMessage.tsx src/types/chat.ts src/pages/ChatPage.tsx
git commit -m "feat: add inline per-item retry with in-place result replacement"
```

---

## Task 11: Check `uint8ArrayToDataUri` utility exists and handles large images

**Files:**
- Verify: `src/tools/shared/imageEncoding.ts`

Task 2 depends on `uint8ArrayToDataUri`. Verify it exists and can handle the image sizes used by context images. If it doesn't exist, check what encoding utilities are available and adapt.

- [ ] **Step 1: Check for existing utility**

Run: `grep -r "uint8ArrayToDataUri\|arrayToDataUri\|toDataUri" src/tools/shared/`

If it doesn't exist, create a minimal version:

```typescript
// src/tools/shared/imageEncoding.ts
export function uint8ArrayToDataUri(data: Uint8Array, mimeType: string): string {
  // Use btoa for small images, or canvas resize for large ones
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
```

If the utility already exists, verify it works for typical image sizes (1-5MB context images). If not, adapt or use a downscaled version for placeholders only.

- [ ] **Step 2: Commit if changes were needed**

```bash
git add src/tools/shared/imageEncoding.ts
git commit -m "feat: add uint8ArrayToDataUri utility for placeholder data URIs"
```

---

## Task 12: Final integration test and lint

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No new warnings beyond the allowed 16

- [ ] **Step 3: Run useEffect validator**

Run: `npm run validate:useeffect`
Expected: No violations

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful build

- [ ] **Step 5: Manual smoke test**

Start both servers (`npm run dev` + `npm run server:dev`) and test:
1. Upload a photo and use "restore photo" → should see blurred uploaded photo as placeholder (not gray box)
2. Upload a persona photo and use "edit image" → should see blurred persona photo(s) as placeholder
3. If 2 context images used in edit_image → should see split-screen blurred placeholder
4. Use "animate photo" with frameRole "both" → should see start + end frame blurred as placeholder
5. Generate multiple images → should see redo button on hover for each completed result
6. Generate multiple videos → should see redo button on hover for each completed thumbnail
7. If any item fails → should see retry button in the failure overlay
8. Click redo on a completed image → should replace just that image inline without new chat entry
9. Click redo on a completed video → should replace just that video inline without new chat entry

- [ ] **Step 6: Commit any fixes from smoke test**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
