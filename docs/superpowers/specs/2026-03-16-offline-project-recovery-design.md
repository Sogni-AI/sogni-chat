# Offline Project Recovery Design

**Date:** 2026-03-16
**Status:** Approved
**Scope:** sogni-client SDK + sogni-chat frontend

## Problem

When a user's socket disconnects temporarily (mobile app switch, phone sleep, brief network loss), in-flight AI generation projects are lost:

1. The SDK immediately marks all tracked projects as `failed` on disconnect
2. The `authenticated` event on reconnect includes `activeProjects` and `unclaimedCompletedProjects` but the SDK ignores both arrays
3. The chat app has no recovery mechanism — completed work is silently lost

This is critical for mobile browser usage where temporary disconnects are frequent.

## Solution Overview

Two-layer fix:

1. **SDK (sogni-client):** Stop failing projects on disconnect. Process the `authenticated` event's project arrays. Emit separate recovery events for active vs completed projects.
2. **Chat app (sogni-chat):** Track `projectId → sessionId` mappings. Listen for recovery events. Route recovered results to the correct chat session.

---

## Layer 1: SDK Changes (sogni-client)

### 1A. Fix `AuthenticatedData` Types

**File:** `src/ApiClient/WebSocketClient/events.ts`

Add types matching server serialization:

```typescript
export interface RecoveredWorkerJob {
  id: string;
  SID: number;
  imgID: string;
  worker: {
    id: string;
    clientSID: number;
    address: string;
    addressSID: number;
    SID: number;
    username: string;
    nftTokenId?: string;
  };
  createTime: number;
  startTime: number | null;
  updateTime: number;
  actualStartTime: number | null;
  endTime: number | null;
  status: string;
  reason: string;
  performedSteps: number;
  triggeredNSFWFilter: boolean;
  seedUsed: number;
  costActual: Record<string, string>;
  network: string;
  txId: string | null;
  jobType: string;
  tokenType: string;
  isTest: boolean;
  // Video-specific
  modelType?: 'video';
  videoFrames?: number;
  videoFps?: number;
  width?: number;
  height?: number;
  provider?: string;
}

export interface RecoveredProject {
  id: string;
  SID: number;
  jobType: string;
  model: {
    id: string;
    SID: number;
    name: string;
    type: string; // 'image' | 'video' | 'music' | 'llm'
  };
  imageCount: number;
  stepCount: number;
  previewCount: number;
  hasGuideImage: boolean;
  hasContextImage1: boolean;
  hasContextImage2: boolean;
  denoiseStrength: string;
  controlNetId: string | null;
  costEstimate: Record<string, unknown>;
  costActual: Record<string, unknown>;
  createTime: number;
  updateTime: number;
  endTime: number | null;
  status: string;
  reason: string | null;
  network: string;
  txId: string | null;
  sizePreset: string;
  width: number;
  height: number;
  jobCountCompletedByState: Record<string, number>;
  isTest: boolean;
  tokenType: string;
  clientRequestData?: string; // base64-encoded JSON
  workerJobs?: RecoveredWorkerJob[];
  completedWorkerJobs?: RecoveredWorkerJob[];
  // Video-specific
  modelType?: 'video';
  videoFrames?: number;
  videoFps?: number;
  provider?: string;
}
```

Update `AuthenticatedData`:

```typescript
interface AuthenticatedData {
  // ... existing fields unchanged ...
  activeProjects: RecoveredProject[];
  unclaimedCompletedProjects: RecoveredProject[];
}
```

### 1B. Stop Failing Projects on Disconnect

**File:** `src/Projects/index.ts` — `handleServerDisconnected` method (lines 544-550)

**Current behavior:** Marks all tracked projects as `failed` with `'Server disconnected'` error.

**New behavior:** Only clear available models. Leave tracked projects alive. They will either:
- Resume when socket reconnects (handler listeners still attached)
- Timeout naturally via existing 2-minute `_checkForTimeout` mechanism

```typescript
private handleServerDisconnected() {
  this._availableModels = [];
  this.emit('availableModels', this._availableModels);
  // Do NOT fail tracked projects — they may recover on reconnect
}
```

### 1C. Add New Events to ProjectApiEvents

**File:** `src/Projects/types/events.ts`

Add to `ProjectApiEvents`:

```typescript
export interface CompletedRecoveredProject extends RecoveredProject {
  /** Resolved download URLs for each completed worker job */
  resultUrls: string[];
}

type ProjectApiEvents = {
  // ... existing events ...
  activeProjectsRecovered: RecoveredProject[];
  completedProjectsRecovered: CompletedRecoveredProject[];
}
```

### 1D. Process `authenticated` Event in ProjectsApi

**File:** `src/Projects/index.ts`

Add socket listener in constructor:

```typescript
this.client.socket.on('authenticated', this.handleSocketAuthenticated.bind(this));
```

New method:

```typescript
private async handleSocketAuthenticated(data: AuthenticatedData) {
  const { activeProjects, unclaimedCompletedProjects } = data;

  // --- Active projects ---
  const unmatchedActive: RecoveredProject[] = [];
  for (const recoveredProject of activeProjects) {
    const tracked = this.projects.find(p => p.id === recoveredProject.id);
    if (tracked) {
      // Already tracked — restore status if it was pending/failed due to disconnect
      if (tracked.status === 'failed' || tracked.status === 'pending') {
        const statusMap: Record<string, ProjectStatus> = {
          queued: 'queued',
          active: 'queued',
          assigned: 'processing',
          progress: 'processing',
        };
        const mappedStatus = statusMap[recoveredProject.status] || 'processing';
        tracked._update({ status: mappedStatus, error: undefined });
      }
      // Otherwise leave it alone — handler listeners are still attached
    } else {
      unmatchedActive.push(recoveredProject);
    }
  }

  // --- Completed projects ---
  const unmatchedCompleted: CompletedRecoveredProject[] = [];
  for (const recoveredProject of unclaimedCompletedProjects) {
    const tracked = this.projects.find(p => p.id === recoveredProject.id);
    if (tracked) {
      // Resolve download URLs for completed jobs and update tracked project
      await this._resolveAndCompleteTrackedProject(tracked, recoveredProject);
    } else {
      // Not tracked — resolve URLs and emit recovery event
      const resultUrls = await this._resolveRecoveredProjectUrls(recoveredProject);
      unmatchedCompleted.push({ ...recoveredProject, resultUrls });
    }
  }

  // Emit recovery events for unmatched projects
  if (unmatchedActive.length > 0) {
    this.emit('activeProjectsRecovered', unmatchedActive);
  }
  if (unmatchedCompleted.length > 0) {
    this.emit('completedProjectsRecovered', unmatchedCompleted);
  }
}
```

Helper methods:

```typescript
/**
 * For a tracked project that completed while offline, resolve download URLs
 * and update the project/jobs to trigger completion events.
 */
private async _resolveAndCompleteTrackedProject(
  tracked: Project,
  recovered: RecoveredProject
) {
  const completedJobs = recovered.completedWorkerJobs || [];
  for (const wj of completedJobs) {
    let job = tracked.job(wj.imgID);
    if (!job) {
      job = tracked._addJob({
        id: wj.imgID,
        projectId: tracked.id,
        status: 'pending',
        step: 0,
        stepCount: recovered.stepCount
      });
    }
    if (job.finished) continue;

    let resultUrl: string | null = null;
    if (!wj.triggeredNSFWFilter) {
      try {
        resultUrl = await this._downloadUrlForRecoveredJob(recovered, wj);
      } catch (e) {
        this.client.logger.error('Failed to resolve URL for recovered job', e);
      }
    }
    job._update({
      status: wj.triggeredNSFWFilter ? 'failed' : 'completed',
      step: wj.performedSteps,
      seed: wj.seedUsed,
      resultUrl,
      isNSFW: wj.triggeredNSFWFilter,
      workerName: wj.worker?.username
    });
  }
  tracked._update({ status: 'completed' });
}

/**
 * Resolve download URLs for an unmatched recovered project.
 */
private async _resolveRecoveredProjectUrls(
  recovered: RecoveredProject
): Promise<string[]> {
  const urls: string[] = [];
  const completedJobs = recovered.completedWorkerJobs || [];
  const isVideo = recovered.model?.type === 'video';
  const isAudio = recovered.model?.type === 'music';
  const isMedia = isVideo || isAudio;

  for (const wj of completedJobs) {
    if (wj.triggeredNSFWFilter) continue;
    try {
      let url: string;
      if (isMedia) {
        url = await this.mediaDownloadUrl({
          jobId: recovered.id,
          id: wj.imgID,
          type: 'complete'
        });
      } else {
        url = await this.downloadUrl({
          jobId: recovered.id,
          imageId: wj.imgID,
          type: 'complete'
        });
      }
      urls.push(url);
    } catch (e) {
      this.client.logger.error('Failed to resolve URL for recovered project', e);
    }
  }
  return urls;
}

/**
 * Get download URL for a single recovered worker job.
 */
private async _downloadUrlForRecoveredJob(
  recovered: RecoveredProject,
  wj: RecoveredWorkerJob
): Promise<string> {
  const isVideo = recovered.model?.type === 'video';
  const isAudio = recovered.model?.type === 'music';
  if (isVideo || isAudio) {
    return this.mediaDownloadUrl({
      jobId: recovered.id,
      id: wj.imgID,
      type: 'complete'
    });
  }
  return this.downloadUrl({
    jobId: recovered.id,
    imageId: wj.imgID,
    type: 'complete'
  });
}
```

---

## Layer 2: Chat App Changes (sogni-chat)

### 2A. Project-Session Map Service

**New file:** `src/services/projectSessionMap.ts`

Maintains `projectId → sessionId` mapping in memory + IndexedDB.

```typescript
const STORE_NAME = 'project_sessions';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ProjectSessionEntry {
  projectId: string;
  sessionId: string;
  createdAt: number;
}

class ProjectSessionMap {
  private map = new Map<string, string>();
  private dbReady: Promise<IDBDatabase>;

  constructor() {
    this.dbReady = this.openDB();
    this.loadFromDB();
  }

  /** Register a project → session mapping */
  async register(projectId: string, sessionId: string): Promise<void> {
    this.map.set(projectId, sessionId);
    const db = await this.dbReady;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      projectId,
      sessionId,
      createdAt: Date.now()
    });
  }

  /** Look up session ID for a project */
  getSessionId(projectId: string): string | undefined {
    return this.map.get(projectId);
  }

  /** Remove a mapping after recovery */
  async remove(projectId: string): Promise<void> {
    this.map.delete(projectId);
    const db = await this.dbReady;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(projectId);
  }

  /** Prune entries older than MAX_AGE_MS */
  async cleanup(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS;
    const db = await this.dbReady;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const range = IDBKeyRange.upperBound(cutoff);
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        this.map.delete(cursor.value.projectId);
        cursor.delete();
        cursor.continue();
      }
    };
  }

  private openDB(): Promise<IDBDatabase> { /* IndexedDB setup with STORE_NAME, index on createdAt */ }
  private async loadFromDB(): Promise<void> { /* Hydrate in-memory map from IndexedDB on init */ }
}

export const projectSessionMap = new ProjectSessionMap();
```

**IndexedDB store schema:**
- Store: `project_sessions`, keyPath: `projectId`
- Index: `createdAt` (for cleanup range queries)

This can be added to the existing `sogni_chat_history` database by bumping `DB_VERSION` in `chatHistoryDB.ts`, or as a separate lightweight DB. Separate DB is simpler (no migration concerns for existing data).

### 2B. Add `sessionId` to ToolExecutionContext

**File:** `src/tools/types.ts`

Add to `ToolExecutionContext`:

```typescript
export interface ToolExecutionContext {
  // ... existing fields ...
  sessionId: string;
}
```

**File:** `src/hooks/useChat.ts`

Pass `sessionIdRef.current` when constructing the context object for tool execution.

### 2C. Tool Handler Changes (All Handlers)

After `projects.create()` in each handler, register the mapping:

```typescript
import { projectSessionMap } from '@/services/projectSessionMap';

// In execute():
const project = await sogniClient.projects.create(projectParams);
projectSessionMap.register(project.id, context.sessionId);
```

**Affected handlers (11 total):**
- `generate-image/handler.ts`
- `generate-video/handler.ts`
- `generate-music/handler.ts`
- `animate-photo/handler.ts`
- `change-angle/handler.ts`
- `edit-image/handler.ts`
- `refine-result/handler.ts`
- `restore-photo/handler.ts`
- `apply-style/handler.ts`
- `video-to-video/handler.ts`
- `sound-to-video/handler.ts`

### 2D. Recovery Handler

**Integrated into `useChat.ts`** (or a new `useProjectRecovery` hook composed into `useChat`).

On mount (when `sogniClient` is available), attach listeners:

```typescript
sogniClient.projects.on('completedProjectsRecovered', handleCompletedRecovery);
sogniClient.projects.on('activeProjectsRecovered', handleActiveRecovery);
```

**`handleCompletedRecovery(projects: CompletedRecoveredProject[])`:**

```
for each project:
  sessionId = projectSessionMap.getSessionId(project.id)
  if (!sessionId) → skip (not our app's project)

  mediaType = project.model.type  // 'image' | 'video' | 'music'
  resultUrls = project.resultUrls  // already resolved by SDK

  if (sessionId === currentSessionId):
    → Add system message to current chat:
      "Your [mediaType] finished while you were away"
    → Attach resultUrls as imageResults/videoResults/audioResults
    → Update allResultUrlsRef / audioResultUrlsRef
  else:
    → updateSessionMessages(sessionId, messages => {
        // Append recovery message with results to that session
        return [...messages, recoveryMessage]
      })
    → Show toast: "A [mediaType] generation completed in '[sessionTitle]'"

  projectSessionMap.remove(project.id)
```

**`handleActiveRecovery(projects: RecoveredProject[])`:**

```
for each project:
  sessionId = projectSessionMap.getSessionId(project.id)
  if (!sessionId) → skip

  // These are still processing. The SDK will emit normal job events
  // for them going forward (since they're now tracked in the SDK's
  // internal list after reconnection... actually they're NOT tracked
  // because they're "unmatched" — they were GC'd).
  //
  // For unmatched active projects: we can't re-attach tool handlers.
  // Log for awareness. They'll appear in completedProjectsRecovered
  // on the next reconnect if they finish while disconnected again,
  // or we could poll/sync via REST.
  //
  // Simplest: show informational message in the appropriate session.
  if (sessionId === currentSessionId):
    → Add system message: "Your [mediaType] is still being processed"
  else:
    → Show toast: "A generation is still in progress in another chat"
```

### 2E. Recovery Message Format

New system message type added to `UIChatMessage`:

```typescript
interface UIChatMessage {
  // ... existing fields ...
  isRecoveryMessage?: boolean;  // For styling differentiation
}
```

The message renders like a normal assistant message with results attached, but with a recovery-specific text prefix.

### 2F. Cleanup

Run `projectSessionMap.cleanup()` on app startup to prune stale entries (>24h old). This prevents unbounded IndexedDB growth.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Page refresh during generation | Project GC'd → unmatched → `completedProjectsRecovered` event → IndexedDB mapping still exists → routes to correct session |
| Tab killed by OS | Same as page refresh |
| Short disconnect (<2s) | SDK reconnects, tracked projects still alive, handler listeners fire normally — no recovery events needed |
| Project from photobooth.sogni.ai | No mapping in projectSessionMap → skipped |
| Multiple tabs | Only the tab with active socket processes recovery. BroadcastChannel syncs session changes to other tabs. |
| Project completed + page refreshed + 24h passed | Mapping pruned by cleanup → project treated as unknown → skipped. Acceptable — user likely doesn't care after 24h. |
| LLM projects in activeProjects | `jobType === 'llm'` → skip. LLM chat completions are stateless and not recoverable. |

## Files Changed

### sogni-client
| File | Change |
|------|--------|
| `src/ApiClient/WebSocketClient/events.ts` | Add `RecoveredProject`, `RecoveredWorkerJob` types. Fix `AuthenticatedData` array types. |
| `src/Projects/types/events.ts` | Add `activeProjectsRecovered` and `completedProjectsRecovered` to `ProjectApiEvents` |
| `src/Projects/index.ts` | Remove project-failing from `handleServerDisconnected`. Add `handleSocketAuthenticated` + helper methods. |

### sogni-chat
| File | Change |
|------|--------|
| `src/services/projectSessionMap.ts` | **New.** ProjectId → SessionId mapping service. |
| `src/tools/types.ts` | Add `sessionId` to `ToolExecutionContext` |
| `src/hooks/useChat.ts` | Pass `sessionId` in context. Add recovery event listeners. Handle recovery messages. |
| `src/tools/*/handler.ts` (11 files) | Add `projectSessionMap.register()` after `projects.create()` |
| `src/utils/chatHistoryDB.ts` | Possibly bump DB version if sharing DB (or separate DB for mapping) |
| `src/types/chat.ts` | Add `isRecoveryMessage` to `UIChatMessage` |
