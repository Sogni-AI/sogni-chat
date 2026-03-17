# Offline Project Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover in-flight and completed AI generation projects when a user's socket reconnects after a temporary disconnect.

**Architecture:** Two-layer fix. The SDK (sogni-client) stops failing projects on disconnect, processes the `authenticated` event's `activeProjects` and `unclaimedCompletedProjects` arrays, and emits separate recovery events. The chat app (sogni-chat) tracks projectId→sessionId mappings in IndexedDB and routes recovered results to the correct chat sessions.

**Tech Stack:** TypeScript, sogni-client SDK, React hooks, IndexedDB

**Spec:** `docs/superpowers/specs/2026-03-16-offline-project-recovery-design.md`

**Notes:**
- `src/utils/chatHistoryDB.ts` requires **no changes** — the ProjectSessionMap uses a separate IndexedDB database to avoid migration concerns.
- The chat app uses `as any` casts when accessing SDK recovery events because the SDK's public type exports don't yet include the recovery types. This is acceptable for now; proper type exports can be added as a follow-up.

---

## Chunk 1: SDK — Types and Disconnect Fix

### Task 1: Add recovery types to SDK events

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-client/src/ApiClient/WebSocketClient/events.ts:5-34`

- [ ] **Step 1: Add `RecoveredWorkerJob` and `RecoveredProject` interfaces**

Before the existing `AuthenticatedData` interface (line 5), add:

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
  speedVsBaseline?: number;
  timings?: Record<string, unknown>;
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
    type: string;
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
  clientRequestData?: string;
  workerJobs?: RecoveredWorkerJob[];
  completedWorkerJobs?: RecoveredWorkerJob[];
  premium?: Record<string, unknown>;
  modelType?: 'video';
  videoFrames?: number;
  videoFps?: number;
  provider?: string;
}
```

- [ ] **Step 2: Update `AuthenticatedData` array types**

Change lines 28-29 from:

```typescript
  activeProjects: [];
  unclaimedCompletedProjects: [];
```

to:

```typescript
  activeProjects: RecoveredProject[];
  unclaimedCompletedProjects: RecoveredProject[];
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-client && npx tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-client
git add src/ApiClient/WebSocketClient/events.ts
git commit -m "feat: add RecoveredProject/RecoveredWorkerJob types and fix AuthenticatedData"
```

### Task 2: Add recovery events to ProjectApiEvents

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-client/src/Projects/types/events.ts:88-92`

- [ ] **Step 1: Import recovery types and add `CompletedRecoveredProject`**

At the top of the file, add the import:

```typescript
import { RecoveredProject } from '../../ApiClient/WebSocketClient/events';
```

After the `ProjectApiEvents` interface (line 88), but first add `CompletedRecoveredProject` before it:

```typescript
export interface CompletedRecoveredProject extends RecoveredProject {
  /** Resolved download URLs for each completed worker job */
  resultUrls: string[];
}
```

- [ ] **Step 2: Add recovery events to `ProjectApiEvents`**

Extend the existing interface (line 88-92) to include:

```typescript
export interface ProjectApiEvents {
  availableModels: AvailableModel[];
  project: ProjectEvent;
  job: JobEvent;
  activeProjectsRecovered: RecoveredProject[];
  completedProjectsRecovered: CompletedRecoveredProject[];
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-client
git add src/Projects/types/events.ts
git commit -m "feat: add activeProjectsRecovered and completedProjectsRecovered events"
```

### Task 3: Add `_pauseTimeout` / `_resumeTimeout` to Project

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-client/src/Projects/Project.ts:228-231`

- [ ] **Step 1: Add `_pauseTimeout` and `_resumeTimeout` methods**

After the existing `_keepAlive` method (line 231), add:

```typescript
  /**
   * Pause the timeout interval during socket disconnect to prevent
   * premature project failure while offline.
   * @internal
   */
  _pauseTimeout() {
    if (this._timeout) {
      clearInterval(this._timeout);
      this._timeout = null;
    }
  }

  /**
   * Resume the timeout interval after socket reconnect.
   * Resets lastUpdated to prevent immediate timeout.
   * @internal
   */
  _resumeTimeout() {
    if (!this._timeout && !this.finished) {
      this.lastUpdated = new Date();
      this._failedSyncAttempts = 0;
      this._timeout = setInterval(this._checkForTimeout.bind(this), PROJECT_TIMEOUT);
    }
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-client
git add src/Projects/Project.ts
git commit -m "feat: add _pauseTimeout/_resumeTimeout for disconnect recovery"
```

### Task 4: Fix `handleServerDisconnected` — stop failing projects

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-client/src/Projects/index.ts:544-550`

- [ ] **Step 1: Replace project-failing disconnect handler**

Replace the existing `handleServerDisconnected` method (lines 544-550):

```typescript
  private handleServerDisconnected() {
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
    this.projects.forEach((p) => {
      p._update({ status: 'failed', error: { code: 0, message: 'Server disconnected' } });
    });
  }
```

with:

```typescript
  private handleServerDisconnected() {
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
    // Do NOT fail tracked projects — they may recover on reconnect.
    // Pause timeout intervals so they don't force-fail during disconnect.
    this.projects.forEach((p) => p._pauseTimeout());
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-client
git add src/Projects/index.ts
git commit -m "fix: stop failing projects on socket disconnect — pause timeouts instead"
```

---

## Chunk 2: SDK — Authenticated Event Processing

### Task 5: Add `handleSocketAuthenticated` and helper methods to ProjectsApi

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-client/src/Projects/index.ts`

This is the largest single change. Add a socket listener in the constructor and implement 5 new private methods.

- [ ] **Step 1: Add imports**

At the top of `index.ts`, add to the existing imports from `events.ts`:

```typescript
import {
  // ... existing imports ...
  AuthenticatedData,
  RecoveredProject,
  RecoveredWorkerJob,
} from '../ApiClient/WebSocketClient/events';
```

Import `CompletedRecoveredProject` from the events types:

```typescript
import { CompletedRecoveredProject } from './types/events';
```

Import `ProjectStatus` from Project:

```typescript
import { ProjectStatus } from './Project';
```

- [ ] **Step 2: Add socket listener in constructor**

In the constructor (after line 206 `this.on('job', this.handleJobEvent.bind(this));`), add:

```typescript
    this.client.socket.on('authenticated', this.handleSocketAuthenticated.bind(this));
```

- [ ] **Step 3: Add `handleSocketAuthenticated` method**

After the `handleServerDisconnected` method, add:

```typescript
  private async handleSocketAuthenticated(data: AuthenticatedData) {
    const { activeProjects, unclaimedCompletedProjects } = data;
    if (!activeProjects?.length && !unclaimedCompletedProjects?.length) return;

    this.client.logger.info(
      `[RECOVERY] Authenticated with ${activeProjects?.length || 0} active, ` +
      `${unclaimedCompletedProjects?.length || 0} unclaimed completed projects`
    );

    // Deduplicate: a project could theoretically appear in both arrays
    const seenIds = new Set<string>();

    // Resume timeouts on all existing tracked projects
    this.projects.forEach((p) => p._resumeTimeout());

    // --- Active projects ---
    const unmatchedActive: RecoveredProject[] = [];
    for (const recovered of (activeProjects || [])) {
      if (recovered.jobType === 'llm') continue;
      seenIds.add(recovered.id);

      const tracked = this.projects.find((p) => p.id === recovered.id);
      if (tracked) {
        // Already tracked — restore status if it drifted during disconnect
        if (tracked.status === 'failed' || tracked.status === 'pending') {
          const statusMap: Record<string, ProjectStatus> = {
            queued: 'queued',
            active: 'queued',
            assigned: 'processing',
            progress: 'processing',
          };
          const mappedStatus = statusMap[recovered.status] || 'processing';
          tracked._update({ status: mappedStatus, error: undefined });
        }
      } else {
        // Unmatched: re-add to tracked projects so normal event flow resumes
        const rehydrated = this._rehydrateProject(recovered);
        this.projects.push(rehydrated);
        unmatchedActive.push(recovered);
      }
    }

    // --- Completed projects ---
    const unmatchedCompleted: CompletedRecoveredProject[] = [];
    for (const recovered of (unclaimedCompletedProjects || [])) {
      if (recovered.jobType === 'llm') continue;
      if (seenIds.has(recovered.id)) continue;

      const tracked = this.projects.find((p) => p.id === recovered.id);
      if (tracked) {
        await this._resolveAndCompleteTrackedProject(tracked, recovered);
      } else {
        const resultUrls = await this._resolveRecoveredProjectUrls(recovered);
        unmatchedCompleted.push({ ...recovered, resultUrls });
      }
    }

    if (unmatchedActive.length > 0) {
      this.client.logger.info(`[RECOVERY] Emitting ${unmatchedActive.length} active recovered projects`);
      this.emit('activeProjectsRecovered', unmatchedActive);
    }
    if (unmatchedCompleted.length > 0) {
      this.client.logger.info(`[RECOVERY] Emitting ${unmatchedCompleted.length} completed recovered projects`);
      this.emit('completedProjectsRecovered', unmatchedCompleted);
    }
  }
```

- [ ] **Step 4: Add `_rehydrateProject` method**

```typescript
  private _rehydrateProject(recovered: RecoveredProject): Project {
    const mediaType = recovered.model?.type === 'video' ? 'video'
      : recovered.model?.type === 'music' ? 'audio'
      : 'image';

    const project = new Project(
      {
        type: mediaType,
        modelId: recovered.model.id,
        positivePrompt: '',
        numberOfMedia: recovered.imageCount,
        steps: recovered.stepCount,
      } as any,
      { api: this, logger: this.client.logger }
    );

    // Override the auto-generated UUID with the server's actual project ID
    (project as any).data.id = recovered.id;

    // Hydrate existing worker jobs
    for (const wj of (recovered.workerJobs || [])) {
      project._addJob({
        id: wj.imgID,
        projectId: recovered.id,
        status: wj.status === 'jobStarted' ? 'processing'
          : wj.status === 'assigned' ? 'initiating'
          : 'pending',
        step: wj.performedSteps || 0,
        stepCount: recovered.stepCount,
        workerName: wj.worker?.username,
      });
    }

    const statusMap: Record<string, ProjectStatus> = {
      queued: 'queued', active: 'queued',
      assigned: 'processing', progress: 'processing',
    };
    project._update({
      status: statusMap[recovered.status] || 'processing'
    });

    return project;
  }
```

- [ ] **Step 5: Add `_resolveAndCompleteTrackedProject` method**

```typescript
  private async _resolveAndCompleteTrackedProject(
    tracked: Project,
    recovered: RecoveredProject
  ) {
    for (const wj of (recovered.completedWorkerJobs || [])) {
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
    // Only mark completed if we resolved at least one job
    const completedJobCount = tracked.jobs.filter((j: any) => j.finished).length;
    if (completedJobCount >= recovered.imageCount) {
      tracked._update({ status: 'completed' });
    }
  }
```

- [ ] **Step 6: Add `_resolveRecoveredProjectUrls` and `_downloadUrlForRecoveredJob` methods**

```typescript
  private async _resolveRecoveredProjectUrls(
    recovered: RecoveredProject
  ): Promise<string[]> {
    const urls: string[] = [];
    const isVideo = recovered.model?.type === 'video';
    const isAudio = recovered.model?.type === 'music';
    const isMedia = isVideo || isAudio;

    for (const wj of (recovered.completedWorkerJobs || [])) {
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

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-client
git add src/Projects/index.ts
git commit -m "feat: process authenticated event — recover active and completed projects"
```

---

## Chunk 3: Chat App — ProjectSessionMap Service

### Task 6: Create `projectSessionMap` service

**Files:**
- Create: `/Users/markledford/Documents/git/sogni-chat/src/services/projectSessionMap.ts`

- [ ] **Step 1: Create the service file**

```typescript
/**
 * Project-to-Session mapping service for offline recovery.
 *
 * When a tool handler creates an SDK project, it registers the mapping
 * projectId → sessionId here. On socket reconnection, recovered projects
 * are routed to the correct chat session via this mapping.
 *
 * Uses a separate IndexedDB database (not the main chat history DB)
 * to avoid migration concerns.
 */

const DB_NAME = 'sogni_project_sessions';
const DB_VERSION = 1;
const STORE_NAME = 'mappings';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ProjectSessionEntry {
  projectId: string;
  sessionId: string;
  createdAt: number;
}

class ProjectSessionMap {
  private map = new Map<string, string>();
  private dbReady: Promise<IDBDatabase>;
  /** Resolves when IndexedDB entries are loaded into the in-memory map */
  ready: Promise<void>;

  constructor() {
    this.dbReady = this.openDB();
    this.ready = this.loadFromDB();
  }

  /** Register a project → session mapping */
  async register(projectId: string, sessionId: string): Promise<void> {
    this.map.set(projectId, sessionId);
    try {
      const db = await this.dbReady;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({
        projectId,
        sessionId,
        createdAt: Date.now(),
      } satisfies ProjectSessionEntry);
    } catch (e) {
      // IndexedDB unavailable (private browsing) — in-memory map still works
      console.warn('[PROJECT SESSION MAP] Failed to persist mapping:', e);
    }
  }

  /** Look up session ID for a project */
  getSessionId(projectId: string): string | undefined {
    return this.map.get(projectId);
  }

  /** Remove a mapping after successful recovery */
  async remove(projectId: string): Promise<void> {
    this.map.delete(projectId);
    try {
      const db = await this.dbReady;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(projectId);
    } catch {
      // Ignore — in-memory already cleared
    }
  }

  /** Prune entries older than MAX_AGE_MS. Call on app startup. */
  async cleanup(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS;
    try {
      const db = await this.dbReady;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          this.map.delete((cursor.value as ProjectSessionEntry).projectId);
          cursor.delete();
          cursor.continue();
        }
      };
    } catch {
      // IndexedDB unavailable — just clear old in-memory entries
      // (not possible to detect age from Map alone, skip)
    }
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private async loadFromDB(): Promise<void> {
    try {
      const db = await this.dbReady;
      return new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const entries = request.result as ProjectSessionEntry[];
          for (const entry of entries) {
            this.map.set(entry.projectId, entry.sessionId);
          }
          console.log(`[PROJECT SESSION MAP] Loaded ${entries.length} mappings from IndexedDB`);
          resolve();
        };
        request.onerror = () => {
          console.warn('[PROJECT SESSION MAP] Failed to load from IndexedDB');
          resolve(); // Don't reject — degrade gracefully
        };
      });
    } catch {
      // IndexedDB unavailable — start with empty map
      console.warn('[PROJECT SESSION MAP] IndexedDB unavailable, using in-memory only');
    }
  }
}

export const projectSessionMap = new ProjectSessionMap();
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-chat && npx tsc --noEmit`
Expected: PASS (or existing errors only, no new ones)

- [ ] **Step 3: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/services/projectSessionMap.ts
git commit -m "feat: add projectSessionMap service for offline recovery"
```

### Task 7: Add `sessionId` to `ToolExecutionContext`

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/types.ts:33-64`

- [ ] **Step 1: Add `sessionId` field**

In the `ToolExecutionContext` interface, after the `onContentFilterChange` field (line 63) and before the closing `}` (line 64), add:

```typescript
  /** Current chat session ID — used by projectSessionMap for offline recovery */
  sessionId: string;
```

- [ ] **Step 2: Pass `sessionId` in useChat.ts execution context**

In `/Users/markledford/Documents/git/sogni-chat/src/hooks/useChat.ts`, in the `executionContext` construction (around line 488-506), add `sessionId`:

After `think: effectiveThink,` (line 505), add:

```typescript
          sessionId: capturedSessionId || '',
```

Also in the `retryToolExecution` method, the execution context is constructed at lines 1202-1220. Find `think: effectiveThink,` around line 1219 and add `sessionId: capturedSessionId || '',` after it.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-chat && npx tsc --noEmit`
Expected: May show errors in tool handlers that don't destructure `sessionId` — that's fine, they just ignore it.

- [ ] **Step 4: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/tools/types.ts src/hooks/useChat.ts
git commit -m "feat: add sessionId to ToolExecutionContext for recovery mapping"
```

---

## Chunk 4: Chat App — Register Mappings in Tool Handlers

### Task 8: Add `projectSessionMap.register()` to all project creation sites

**Files (11 call sites across 10 files + 5 callers that pass sessionId through):**

Direct `projects.create()` call sites:
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/generate-image/handler.ts:423`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/generate-video/handler.ts:365`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/generate-music/handler.ts:202`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/edit-image/handler.ts:321`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/sound-to-video/handler.ts:441`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/video-to-video/handler.ts:328`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/services/sdk/imageGeneration.ts:281,406`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/services/sdk/videoGeneration.ts:133`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/services/sdk/styleTransfer.ts:98`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/services/sdk/angleGeneration.ts:112`

Callers of SDK service functions (need to pass `context.sessionId` through):
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/restore-photo/handler.ts`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/apply-style/handler.ts`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/change-angle/handler.ts`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/animate-photo/handler.ts`
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/tools/refine-result/handler.ts`

The pattern is the same everywhere. After every `projects.create()` call, add one line.

- [ ] **Step 1: Add import and register call in each tool handler**

For each of the 6 tool handler files, add import at top:

```typescript
import { projectSessionMap } from '@/services/projectSessionMap';
```

Then after each `const project = await ... .projects.create(projectParams);` line, add:

```typescript
  projectSessionMap.register(project.id, context.sessionId);
```

- [ ] **Step 2: Add register call in each SDK service wrapper**

For the 4 SDK service files (`imageGeneration.ts`, `videoGeneration.ts`, `styleTransfer.ts`, `angleGeneration.ts`), these are called by tool handlers that pass the context. However, these service functions don't receive `context.sessionId` directly.

**Two options:**
- (A) Pass `sessionId` as a parameter to these service functions
- (B) Register at the tool handler level instead (after the service function returns the project or result URLs)

Option B is simpler — but the service functions don't return the project ID. Look at how `restore-photo`, `apply-style`, `change-angle`, and `animate-photo` handlers use these services. They call the service which internally calls `projects.create()`, listens for events, and resolves with result URLs. The project ID is not exposed to the handler.

**Resolution: Option A — add `sessionId` parameter to each SDK service function.**

For each of the 4 service files, add the import:

```typescript
import { projectSessionMap } from '@/services/projectSessionMap';
```

Add `sessionId: string` to the function parameters, and after the `projects.create()` call add:

```typescript
  projectSessionMap.register(project.id, sessionId);
```

Then update the calling tool handlers to pass `context.sessionId`:
- `restore-photo/handler.ts` → calls `restorePhoto()` → pass `context.sessionId`
- `apply-style/handler.ts` → calls a function from `styleTransfer.ts` → pass `context.sessionId`
- `change-angle/handler.ts` → calls a function from `angleGeneration.ts` → pass `context.sessionId`
- `animate-photo/handler.ts` → calls a function from `videoGeneration.ts` → pass `context.sessionId`
- `refine-result/handler.ts` → calls `restorePhoto()` or `runImageGeneration()` → pass `context.sessionId`

**Note:** Carefully read each service function and handler to determine the exact signature change needed. The context for each function differs — some take named params, some take an options object.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-chat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/tools/*/handler.ts src/services/sdk/*.ts
git commit -m "feat: register projectId→sessionId mapping on every project creation"
```

---

## Chunk 5: Chat App — Recovery Handler

### Task 9: Add `isRecoveryMessage` to UIChatMessage

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/types/chat.ts:10-42`

- [ ] **Step 1: Add field to interface**

In the `UIChatMessage` interface, after `isFromHistory` (line 41), add:

```typescript
  /** True for messages created by the offline recovery system */
  isRecoveryMessage?: boolean;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/types/chat.ts
git commit -m "feat: add isRecoveryMessage flag to UIChatMessage"
```

### Task 10: Add recovery event listeners in useChat.ts

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/hooks/useChat.ts`

This integrates the recovery handler into the existing `useChat` hook. The key is that recovery listeners need to be attached once when a `sogniClient` is available, and cleaned up on unmount.

- [ ] **Step 1: Add imports**

At the top of `useChat.ts`, add:

```typescript
import { projectSessionMap } from '@/services/projectSessionMap';
import { updateSessionMessages } from '@/utils/chatHistoryDB';
```

- [ ] **Step 2: Add `onRecoveryMessage` callback ref**

After `onBackgroundGallerySavedRef` (around line 262), add:

```typescript
  // Callback for showing recovery toasts (set by ChatPage or parent)
  const onRecoveryToastRef = useRef<((message: string) => void) | null>(null);
```

- [ ] **Step 3: Add `setOnRecoveryToast` setter**

After `setOnBackgroundGallerySaved` (around line 1089), add:

```typescript
  const setOnRecoveryToast = useCallback((cb: typeof onRecoveryToastRef.current) => {
    onRecoveryToastRef.current = cb;
  }, []);
```

- [ ] **Step 4: Add `handleProjectRecovery` function**

Create a new function inside the `useChat` hook (after the `setOnRecoveryToast`):

```typescript
  /**
   * Attach SDK recovery event listeners. Called once when sogniClient is available.
   * Returns cleanup function to remove listeners.
   */
  const attachRecoveryListeners = useCallback((sogniClient: SogniClient) => {
    const handleCompletedRecovery = async (projects: any[]) => {
      // Ensure IndexedDB mappings are loaded (critical for page-refresh recovery)
      await projectSessionMap.ready;
      console.log(`[CHAT HOOK] Recovery: ${projects.length} completed projects recovered`);
      for (const project of projects) {
        const sessionId = projectSessionMap.getSessionId(project.id);
        if (!sessionId) continue; // Not our app's project

        const modelType = project.model?.type || 'image';
        const mediaLabel = modelType === 'video' ? 'video'
          : modelType === 'music' ? 'music'
          : 'image';
        const resultUrls: string[] = project.resultUrls || [];
        if (resultUrls.length === 0) continue;

        const isImage = modelType === 'image';
        const isVideo = modelType === 'video';
        const isAudio = modelType === 'music';

        const recoveryMsg: UIChatMessage = {
          id: `recovery-${project.id}-${Date.now()}`,
          role: 'assistant',
          content: `Your ${mediaLabel} finished while you were away.`,
          timestamp: Date.now(),
          ...(isImage ? { imageResults: resultUrls } : {}),
          ...(isVideo ? { videoResults: resultUrls } : {}),
          ...(isAudio ? { audioResults: resultUrls } : {}),
          modelName: project.model?.name,
          isRecoveryMessage: true,
        };

        if (sessionId === sessionIdRef.current) {
          // Current session — add message to UI
          if (isImage) {
            allResultUrlsRef.current = [...allResultUrlsRef.current, ...resultUrls];
            setAllResultUrls((prev) => [...prev, ...resultUrls]);
          }
          if (isAudio) {
            audioResultUrlsRef.current = [...audioResultUrlsRef.current, ...resultUrls];
          }
          setUIMessages((prev) => [...prev, recoveryMsg]);
        } else {
          // Different session — update IndexedDB directly
          updateSessionMessages(sessionId, (msgs) => [...msgs, recoveryMsg]);
          onRecoveryToastRef.current?.(
            `A ${mediaLabel} generation completed in another chat`
          );
        }

        projectSessionMap.remove(project.id);
      }
    };

    const handleActiveRecovery = async (projects: any[]) => {
      await projectSessionMap.ready;
      console.log(`[CHAT HOOK] Recovery: ${projects.length} active projects still processing`);
      for (const project of projects) {
        const sessionId = projectSessionMap.getSessionId(project.id);
        if (!sessionId) continue;

        const modelType = project.model?.type || 'image';
        const mediaLabel = modelType === 'video' ? 'video'
          : modelType === 'music' ? 'music'
          : 'image';

        // Find the re-hydrated SDK Project instance to attach completion listeners
        const sdkProject = (sogniClient as any).projects?.trackedProjects?.find(
          (p: any) => p.id === project.id
        );

        const recoveryMsgId = `recovery-active-${project.id}-${Date.now()}`;

        if (sessionId === sessionIdRef.current) {
          // Current session — show progress message
          const progressMsg: UIChatMessage = {
            id: recoveryMsgId,
            role: 'assistant',
            content: `Your ${mediaLabel} is still being processed...`,
            timestamp: Date.now(),
            toolProgress: {
              type: 'started',
              toolName: (modelType === 'video' ? 'generate_video'
                : modelType === 'music' ? 'generate_music'
                : 'generate_image') as ToolName,
            },
            isRecoveryMessage: true,
          };
          setUIMessages((prev) => [...prev, progressMsg]);

          // Attach completion listener on the re-hydrated SDK project
          if (sdkProject) {
            sdkProject.on('completed', (urls: string[]) => {
              const isImage = modelType === 'image';
              const isVideo = modelType === 'video';
              const isAudio = modelType === 'music';
              if (isImage) {
                allResultUrlsRef.current = [...allResultUrlsRef.current, ...urls];
                setAllResultUrls((prev) => [...prev, ...urls]);
              }
              if (isAudio) {
                audioResultUrlsRef.current = [...audioResultUrlsRef.current, ...urls];
              }
              setUIMessages((prev) =>
                prev.map((msg) =>
                  msg.id === recoveryMsgId
                    ? {
                        ...msg,
                        content: `Your ${mediaLabel} finished while you were away.`,
                        toolProgress: null,
                        ...(isImage ? { imageResults: urls } : {}),
                        ...(isVideo ? { videoResults: urls } : {}),
                        ...(isAudio ? { audioResults: urls } : {}),
                        modelName: project.model?.name,
                      }
                    : msg,
                ),
              );
              projectSessionMap.remove(project.id);
            });
            sdkProject.on('failed', () => {
              setUIMessages((prev) =>
                prev.map((msg) =>
                  msg.id === recoveryMsgId
                    ? {
                        ...msg,
                        content: `Your ${mediaLabel} generation failed.`,
                        toolProgress: null,
                      }
                    : msg,
                ),
              );
              projectSessionMap.remove(project.id);
            });
          }
        } else {
          // Different session — just show toast, attach background listener
          onRecoveryToastRef.current?.(
            `A ${mediaLabel} generation is still in progress in another chat`
          );
          if (sdkProject) {
            sdkProject.on('completed', (urls: string[]) => {
              const isImage = modelType === 'image';
              const isVideo = modelType === 'video';
              const isAudio = modelType === 'music';
              const completedMsg: UIChatMessage = {
                id: `recovery-${project.id}-done-${Date.now()}`,
                role: 'assistant',
                content: `Your ${mediaLabel} finished while you were away.`,
                timestamp: Date.now(),
                ...(isImage ? { imageResults: urls } : {}),
                ...(isVideo ? { videoResults: urls } : {}),
                ...(isAudio ? { audioResults: urls } : {}),
                modelName: project.model?.name,
                isRecoveryMessage: true,
              };
              updateSessionMessages(sessionId, (msgs) => [...msgs, completedMsg]);
              onRecoveryToastRef.current?.(
                `A ${mediaLabel} generation completed in another chat`
              );
              projectSessionMap.remove(project.id);
            });
          }
        }
      }
    };

    (sogniClient as any).projects?.on?.('completedProjectsRecovered', handleCompletedRecovery);
    (sogniClient as any).projects?.on?.('activeProjectsRecovered', handleActiveRecovery);

    return () => {
      (sogniClient as any).projects?.off?.('completedProjectsRecovered', handleCompletedRecovery);
      (sogniClient as any).projects?.off?.('activeProjectsRecovered', handleActiveRecovery);
    };
  }, []);
```

- [ ] **Step 5: Expose `attachRecoveryListeners` and `setOnRecoveryToast` in return value**

In the return object of `useChat` (at the bottom of the hook), add:

```typescript
    attachRecoveryListeners,
    setOnRecoveryToast,
```

And update the `UseChatResult` interface to include:

```typescript
  /** Attach SDK recovery listeners. Call once when sogniClient is available. Returns cleanup fn. */
  attachRecoveryListeners: (sogniClient: SogniClient) => () => void;
  /** Set callback for recovery toast notifications */
  setOnRecoveryToast: (cb: ((message: string) => void) | null) => void;
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/markledford/Documents/git/sogni-chat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/hooks/useChat.ts
git commit -m "feat: add project recovery event listeners to useChat hook"
```

---

## Chunk 6: Chat App — Integration and Cleanup

### Task 11: Wire recovery listeners in ChatPage

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/pages/ChatPage.tsx` (or wherever `useChat` is consumed and `sogniClient` is available)

- [ ] **Step 1: Identify where sogniClient becomes available**

Read `ChatPage.tsx` to find where `sogniClient` is obtained (likely from `useSogniAuth` or similar). Add an effect:

```typescript
useEffect(() => {
  if (!sogniClient) return;
  const cleanup = chat.attachRecoveryListeners(sogniClient);
  return cleanup;
}, [sogniClient, chat.attachRecoveryListeners]);
```

- [ ] **Step 2: Wire recovery toast to the app's toast system**

```typescript
useEffect(() => {
  chat.setOnRecoveryToast((message) => {
    // Use the app's existing toast system
    showToast({ message, type: 'info' });
  });
  return () => chat.setOnRecoveryToast(null);
}, [chat.setOnRecoveryToast]);
```

- [ ] **Step 3: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/pages/ChatPage.tsx
git commit -m "feat: wire recovery listeners and toast in ChatPage"
```

### Task 12: Run cleanup on startup

**Files:**
- Modify: `/Users/markledford/Documents/git/sogni-chat/src/pages/ChatPage.tsx` (or app entry)

- [ ] **Step 1: Add cleanup call on mount**

```typescript
import { projectSessionMap } from '@/services/projectSessionMap';

// In a useEffect that runs once on mount:
useEffect(() => {
  projectSessionMap.cleanup();
}, []);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/markledford/Documents/git/sogni-chat
git add src/pages/ChatPage.tsx
git commit -m "feat: prune stale project-session mappings on app startup"
```

### Task 13: Verify full build

- [ ] **Step 1: Build sogni-client**

```bash
cd /Users/markledford/Documents/git/sogni-client && npm run build
```
Expected: PASS

- [ ] **Step 2: Build sogni-chat**

```bash
cd /Users/markledford/Documents/git/sogni-chat && npm run build
```
Expected: PASS

- [ ] **Step 3: Lint sogni-chat**

```bash
cd /Users/markledford/Documents/git/sogni-chat && npm run lint
```
Expected: PASS (or ≤16 existing warnings)

---

## Summary of All Files Changed

### sogni-client (4 files)
| File | Change |
|------|--------|
| `src/ApiClient/WebSocketClient/events.ts` | Add `RecoveredProject`, `RecoveredWorkerJob` types. Fix `AuthenticatedData`. |
| `src/Projects/types/events.ts` | Add `CompletedRecoveredProject`, recovery events to `ProjectApiEvents`. |
| `src/Projects/Project.ts` | Add `_pauseTimeout()`, `_resumeTimeout()`. |
| `src/Projects/index.ts` | Fix `handleServerDisconnected`. Add `handleSocketAuthenticated` + 4 helpers. |

### sogni-chat (14+ files)
| File | Change |
|------|--------|
| `src/services/projectSessionMap.ts` | **New.** ProjectId→SessionId mapping with IndexedDB persistence. |
| `src/tools/types.ts` | Add `sessionId` to `ToolExecutionContext`. |
| `src/types/chat.ts` | Add `isRecoveryMessage` to `UIChatMessage`. |
| `src/hooks/useChat.ts` | Pass `sessionId` in context. Add `attachRecoveryListeners`, `setOnRecoveryToast`. |
| `src/pages/ChatPage.tsx` | Wire recovery listeners, toast, and cleanup. |
| `src/tools/generate-image/handler.ts` | Add `projectSessionMap.register()`. |
| `src/tools/generate-video/handler.ts` | Add `projectSessionMap.register()`. |
| `src/tools/generate-music/handler.ts` | Add `projectSessionMap.register()`. |
| `src/tools/edit-image/handler.ts` | Add `projectSessionMap.register()`. |
| `src/tools/sound-to-video/handler.ts` | Add `projectSessionMap.register()`. |
| `src/tools/video-to-video/handler.ts` | Add `projectSessionMap.register()`. |
| `src/services/sdk/imageGeneration.ts` | Add `sessionId` param + `projectSessionMap.register()`. |
| `src/services/sdk/videoGeneration.ts` | Add `sessionId` param + `projectSessionMap.register()`. |
| `src/services/sdk/styleTransfer.ts` | Add `sessionId` param + `projectSessionMap.register()`. |
| `src/services/sdk/angleGeneration.ts` | Add `sessionId` param + `projectSessionMap.register()`. |
