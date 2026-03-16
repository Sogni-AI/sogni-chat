# Unified Media Attachments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all image uploads into a single `useMediaUpload` path with persistent thumbnails, remove `useImageUpload`, and persist attached files to IndexedDB.

**Architecture:** Replace the dual upload system (useImageUpload for primary image + useMediaUpload for attachments) with a single `useMediaUpload` hook. Images show as aspect-ratio-correct thumbnails that persist across sends and sessions. Up to 6 images supported. Auto-analysis on upload is removed — the LLM responds only after the user submits a request.

**Tech Stack:** React hooks, IndexedDB (via chatHistoryDB), Blob URLs for thumbnails, existing fileUpload.ts for validation/processing.

---

## File Map

### Files to Create
- None

### Files to Modify
1. `src/hooks/useMediaUpload.ts` — Add 6-image cap, blob URL management for thumbnails
2. `src/components/chat/ChatInput.tsx` — Render image thumbnails instead of text chips
3. `src/types/chat.ts` — Add `uploadedFiles` field to `ChatSession`
4. `src/components/chat/ChatPanel.tsx` — Remove auto-clear after send, pass preview URLs, remove auto-analysis trigger
5. `src/pages/ChatPage.tsx` — Remove `useImageUpload`, route all uploads through `useMediaUpload`, update session save/restore
6. `src/hooks/useChat.ts` — Remove `promotedImageRef`, derive imageData from uploadedFiles
7. `src/hooks/useChatSessions.ts` — Persist/restore uploadedFiles in sessions

### Files to Delete
1. `src/hooks/useImageUpload.ts` — Fully replaced by enhanced `useMediaUpload`

---

## Chunk 1: Core Infrastructure

### Task 1: Add uploadedFiles to ChatSession type

**Files:**
- Modify: `src/types/chat.ts`

- [ ] **Step 1: Add uploadedFiles field to ChatSession interface**

Add `uploadedFiles?: UploadedFile[]` to the ChatSession interface. Import the UploadedFile type.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

---

### Task 2: Enhance useMediaUpload with 6-image cap and blob URL management

**Files:**
- Modify: `src/hooks/useMediaUpload.ts`

- [ ] **Step 1: Add MAX_IMAGE_FILES constant and enforce in addFile**

Add `const MAX_IMAGE_FILES = 6`. In `addFile`, before processing, count existing image files. If count >= 6 and the new file is an image, set error and return.

- [ ] **Step 2: Add blob URL management**

Add a `previewUrls` ref (Map<number, string>) that caches blob URLs keyed by a stable file identifier. Add `getPreviewUrl(index)` that lazily creates blob URLs for image files. Add cleanup: revoke URLs on removeFile and clearFiles. Return `getPreviewUrl` from the hook.

- [ ] **Step 3: Add loadFiles method for session restoration**

Add `loadFiles(files: UploadedFile[])` method that replaces the current uploadedFiles state and clears/rebuilds preview URL cache. Return it from the hook.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```
git add src/types/chat.ts src/hooks/useMediaUpload.ts
git commit -m "Enhance useMediaUpload: 6-image cap, blob URL previews, loadFiles for restoration"
```

---

## Chunk 2: ChatInput Thumbnails

### Task 3: Update ChatInput to render image thumbnails

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

- [ ] **Step 1: Add getPreviewUrl prop**

Add `getPreviewUrl?: (index: number) => string | null` to ChatInputProps.

- [ ] **Step 2: Render thumbnails for image files**

In the file chips area, when rendering an uploaded file: if `getPreviewUrl(index)` returns a URL, render an aspect-ratio-correct thumbnail (~48px tall, auto width, rounded corners, with an X button overlay in the top-right). Otherwise fall back to the existing text chip style.

Thumbnail styling:
- Height: 48px, width: auto (aspect ratio preserved)
- Border radius: `var(--radius-md)`
- X button: positioned top-right, semi-transparent dark background circle, white X icon
- Container: `position: relative`, `display: inline-block`

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```
git add src/components/chat/ChatInput.tsx
git commit -m "Add image thumbnail previews in ChatInput attachment area"
```

---

## Chunk 3: Remove useImageUpload and Unify Upload Flow

### Task 4: Update ChatPage to remove useImageUpload

**Files:**
- Modify: `src/pages/ChatPage.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`
- Delete: `src/hooks/useImageUpload.ts`

- [ ] **Step 1: Update ChatPage — replace useImageUpload with useMediaUpload**

Remove the `useImageUpload` import and hook call. The following state that previously came from useImageUpload needs new sources:

- `imageData`, `width`, `height` → derive from first image in `uploadedFiles` (compute with useMemo)
- `imageUrl` → derive from `getPreviewUrl(0)` for the first image, or compute a blob URL from the first image's data
- `upload(file)` → replace with `addMediaFile(file)`
- `clear()` / `clearUpload()` → replace with `clearMediaFiles()`
- `loadFromData(data, w, h)` → replace with `loadFiles([...])` from enhanced useMediaUpload
- `error: uploadError` → use `mediaUploadError`

- [ ] **Step 2: Update handleFileSelect and handleFileDrop**

These currently call `upload(file)` from useImageUpload. Change to call `addMediaFile(file)` instead. Remove the session reset/clearUpload/chat.reset flow — the new flow is: image gets attached as a thumbnail, session is created on first send (already handled by the existing session creation effect).

Simplify to:
```typescript
const handleFileSelect = useCallback(async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await addMediaFile(file);
}, [addMediaFile]);
```

Similarly for handleFileDrop.

- [ ] **Step 3: Update session save/restore to use uploadedFiles**

In `saveActiveSession`: replace `imageData: imageDataRef.current` with `uploadedFiles` from useMediaUpload state.

In the `pendingRestore` effect: replace `loadFromData(pendingRestore.imageData, ...)` with `loadFiles(pendingRestore.uploadedFiles || [])`.

In `handleSelectSession`: replace `loadFromData(session.imageData, ...)` with `loadFiles(session.uploadedFiles || [])`.

- [ ] **Step 4: Update gallery save and thumbnail generation**

Gallery auto-save (line ~345): derive sourceImageBlob from first uploadedFile instead of imageData.

Thumbnail update effect: derive from first uploaded image file.

- [ ] **Step 5: Update ChatPanel props**

Remove `imageData`, `imageUrl`, `width`, `height` props that came from useImageUpload. Instead pass derived values or compute them in ChatPanel from uploadedFiles.

Add `getPreviewUrl` prop to pass through to ChatInput.

- [ ] **Step 6: Update ChatPanel — remove auto-analysis trigger**

Remove the `useEffect` that triggers `analyzeImage` when imageData becomes available. Remove the `analysisTriggeredRef`. Remove imports of `VIDEO_VISION_ANALYSIS_SYSTEM_PROMPT`.

- [ ] **Step 7: Update ChatPanel — remove onClearMediaFiles from handleSend**

In `handleSend`, remove the `onClearMediaFiles?.()` call. Files now persist across sends.

- [ ] **Step 8: Update ChatPanel — derived state**

Compute `hasImage` from uploadedFiles having an image, not from imageData/imageUrl.

The `processedMessages` memo that injects `uploadedImageUrl` into the user-upload message: derive from first uploaded image's preview URL.

Before/after comparison: derive `imageUrl` for the "before" image from first uploaded image.

- [ ] **Step 9: Delete useImageUpload.ts**

Remove `src/hooks/useImageUpload.ts`. Search for any remaining imports and fix them.

- [ ] **Step 10: Verify build**

Run: `npx tsc --noEmit`
Run: `npm run lint`

- [ ] **Step 11: Commit**

```
git add -A
git commit -m "Unify upload flow: remove useImageUpload, route all uploads through useMediaUpload"
```

---

## Chunk 4: Update useChat and Session Persistence

### Task 5: Remove promotedImageRef from useChat

**Files:**
- Modify: `src/hooks/useChat.ts`

- [ ] **Step 1: Remove promotedImageRef and simplify image promotion**

Remove the `promotedImageRef` ref declaration, its cache logic in `runRequest`, and its cleanup in `reset()` and `loadFromSession()`.

Keep the inline promotion: when `context.imageData` is null, derive from first image in `context.uploadedFiles`. This is now safe because uploadedFiles persists (not cleared after send).

```typescript
const primaryImage = !context.imageData
  ? (context.uploadedFiles || []).find(f => f.type === 'image')
  : undefined;

const executionContext: ToolExecutionContext = {
  imageData: context.imageData || (primaryImage?.data ?? null),
  width: context.imageData ? context.width : (primaryImage?.width || context.width),
  height: context.imageData ? context.height : (primaryImage?.height || context.height),
  ...
};
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```
git add src/hooks/useChat.ts
git commit -m "Remove promotedImageRef: uploadedFiles now persists across sends"
```

---

### Task 6: Persist uploadedFiles in session save/restore

**Files:**
- Modify: `src/hooks/useChatSessions.ts`

- [ ] **Step 1: Ensure uploadedFiles flows through session CRUD**

The ChatSession type already has `uploadedFiles?` from Task 1. Verify that `saveCurrentSession` passes the full session object (including uploadedFiles) to IndexedDB. Since chatHistoryDB's `saveSession` just does a put() on the whole object, this should work automatically once ChatPage includes uploadedFiles in the session object.

No changes likely needed in useChatSessions itself — the ChatPage changes in Task 4 handle populating uploadedFiles in the session object.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

---

## Chunk 5: Final Cleanup

### Task 7: Clean up removed features

**Files:**
- Modify: `src/pages/ChatPage.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Remove dead code**

Remove any remaining references to:
- `uploadIntent` state (no longer needed without auto-analysis — or keep if welcome screen buttons still set intent for suggestion chips)
- `ChatAnalysisIndicator` component import (if analysis is fully removed)
- `IntentCaptureCard` component import (if restore intent capture is removed)
- `isAnalyzing` state usage
- `VIDEO_VISION_ANALYSIS_SYSTEM_PROMPT` import
- `EDIT_INTENT_SUGGESTIONS` import (if no longer used)

Actually: keep `uploadIntent` if the welcome screen upload buttons still differentiate between animate/edit/restore for the purpose of suggestion chip selection. Only remove if that distinction is no longer needed.

- [ ] **Step 2: Remove useImageUpload's IndexedDB database**

The old `sogni_chat_image` IndexedDB database is now orphaned. Add a one-time cleanup in ChatPage or app init that deletes it:
```typescript
indexedDB.deleteDatabase('sogni_chat_image');
```

- [ ] **Step 3: Full build and lint verification**

Run: `npx tsc --noEmit`
Run: `npm run lint`

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "Clean up removed auto-analysis features and orphaned IndexedDB"
```

---

## Implementation Notes

### What NOT to change
- `chatService.ts` — `prepareVisionDataUri` already handles uploadedFiles as fallback. No changes needed.
- `fileUpload.ts` — Already handles all media types.
- `chatHistoryDB.ts` — IndexedDB schema is flexible; optional fields don't need a version bump.
- Tool handlers — Already access images via `context.imageData` and `context.uploadedFiles`.
- `galleryService.ts` — Interface stays the same, just called with different source data.

### Migration concerns
- Existing sessions in IndexedDB have `imageData`/`width`/`height` but no `uploadedFiles`. The restore logic should handle both: if `uploadedFiles` exists, use it; otherwise fall back to constructing an UploadedFile from legacy `imageData`/`width`/`height`.
- The old `sogni_chat_image` IndexedDB (from useImageUpload persist mode) should be cleaned up.
