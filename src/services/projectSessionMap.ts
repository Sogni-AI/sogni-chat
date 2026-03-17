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
          resolve();
        };
      });
    } catch {
      console.warn('[PROJECT SESSION MAP] IndexedDB unavailable, using in-memory only');
    }
  }
}

export const projectSessionMap = new ProjectSessionMap();
