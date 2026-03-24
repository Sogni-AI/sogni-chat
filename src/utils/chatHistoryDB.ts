/**
 * Chat History IndexedDB Wrapper
 *
 * Persists chat sessions and thumbnails in IndexedDB. Follows the singleton
 * pattern from galleryDB.ts. Includes one-time migration from the legacy
 * localStorage-based `sogni_chat_session` key.
 */

import type { ChatSession, ChatSessionSummary, ChatSessionThumbnail, UIChatMessage } from '@/types/chat';
// TODO: Once useChat hook is copied, import UIChatMessage from @/hooks/useChat instead of @/types/chat

const DB_NAME = 'sogni_chat_history';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const THUMBNAILS_STORE = 'thumbnails';
const LEGACY_STORAGE_KEY = 'sogni_chat_session';
const MIGRATION_FLAG = 'sogni_chat_history_migrated';

let dbInstance: IDBDatabase | null = null;

// ============================================================================
// Database Init
// ============================================================================

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to open database:', request.error);
      reject(new Error('Failed to open chat history database'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(THUMBNAILS_STORE)) {
        db.createObjectStore(THUMBNAILS_STORE, { keyPath: 'sessionId' });
      }
    };
  });
}

// ============================================================================
// Session CRUD
// ============================================================================

/** Save or update a chat session */
export async function saveSession(session: ChatSession): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    tx.objectStore(SESSIONS_STORE).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to save session:', tx.error);
      reject(new Error('Failed to save chat session'));
    };
  });
}

/**
 * Load a session, apply an updater to its messages, and save back atomically.
 * Uses a single readwrite transaction so concurrent calls on the same session
 * are serialized by IndexedDB — the second call reads AFTER the first commits,
 * preventing the read-modify-write race that could lose results or gallery IDs.
 * Used for persisting background job results to non-active sessions.
 * Returns the updated session, or null if session not found.
 */
export async function updateSessionMessages(
  sessionId: string,
  updater: (messages: UIChatMessage[]) => UIChatMessage[],
): Promise<ChatSession | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = () => {
      const session: ChatSession | undefined = getReq.result;
      if (!session) {
        resolve(null);
        return;
      }
      const updatedMessages = updater(session.uiMessages);
      const allImageUrls = updatedMessages.flatMap(m => m.imageResults || []);
      const allResultUrls = [...new Set([...session.allResultUrls, ...allImageUrls])];
      const allAudioUrls = updatedMessages.flatMap(m => m.audioResults || []);
      const audioResultUrls = [...new Set([...(session.audioResultUrls || []), ...allAudioUrls])];
      const updated: ChatSession = {
        ...session,
        uiMessages: updatedMessages,
        allResultUrls,
        audioResultUrls,
        updatedAt: Date.now(),
      };
      store.put(updated);
      tx.oncomplete = () => resolve(updated);
    };
    getReq.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to read session for update:', getReq.error);
      reject(new Error('Failed to update session messages'));
    };
    tx.onerror = () => {
      console.error('[CHAT HISTORY DB] Transaction failed during update:', tx.error);
      reject(new Error('Failed to update session messages'));
    };
  });
}

/** Get all sessions as lightweight summaries, sorted by updatedAt descending.
 *  Uses a cursor to avoid loading heavy fields (imageData, conversation, uiMessages). */
export async function getAllSessions(): Promise<ChatSessionSummary[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const summaries: ChatSessionSummary[] = [];
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const s = cursor.value as ChatSession;
        summaries.push({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          hasImage: !!s.imageData || !!(s.uploadedFiles?.some(f => f.type === 'image')),
          pinned: s.pinned,
        });
        cursor.continue();
      } else {
        summaries.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(summaries);
      }
    };

    request.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to get sessions:', request.error);
      reject(new Error('Failed to load chat sessions'));
    };
  });
}

/** Get a full session by ID */
export async function getSession(id: string): Promise<ChatSession | null> {
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to get session:', request.error);
      reject(new Error('Failed to load chat session'));
    };
  });
}

/** Update specific fields on a session without loading/saving the entire object */
export async function updateSessionFields(
  id: string,
  fields: Partial<Pick<ChatSession, 'title' | 'pinned'>>,
): Promise<void> {
  if (!id) return;
  const session = await getSession(id);
  if (!session) return;
  const updated = { ...session, ...fields };
  await saveSession(updated);
}

/** Delete a session and its thumbnail */
export async function deleteSession(id: string): Promise<void> {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS_STORE, THUMBNAILS_STORE], 'readwrite');
    tx.objectStore(SESSIONS_STORE).delete(id);
    tx.objectStore(THUMBNAILS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to delete session:', tx.error);
      reject(new Error('Failed to delete chat session'));
    };
  });
}

// ============================================================================
// Thumbnail Operations
// ============================================================================

/** Save a session thumbnail */
export async function saveThumbnail(thumbnail: ChatSessionThumbnail): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, 'readwrite');
    tx.objectStore(THUMBNAILS_STORE).put(thumbnail);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to save thumbnail:', tx.error);
      reject(new Error('Failed to save thumbnail'));
    };
  });
}

/** Get a thumbnail by session ID */
export async function getThumbnail(sessionId: string): Promise<ChatSessionThumbnail | null> {
  if (!sessionId) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, 'readonly');
    const store = tx.objectStore(THUMBNAILS_STORE);
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[CHAT HISTORY DB] Failed to get thumbnail:', request.error);
      reject(new Error('Failed to load thumbnail'));
    };
  });
}

// ============================================================================
// Thumbnail Generation
// ============================================================================

/** Generate a small JPEG thumbnail from a Blob using canvas */
export function generateThumbnail(blob: Blob, maxWidth = 150): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width === 0 || img.height === 0) {
        reject(new Error('Invalid image dimensions'));
        return;
      }
      const scale = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error('Failed to generate thumbnail'));
        },
        'image/jpeg',
        0.7,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for thumbnail'));
    };

    img.src = url;
  });
}

// ============================================================================
// Legacy Migration
// ============================================================================

/**
 * One-time migration from localStorage `sogni_chat_session` to IndexedDB.
 * Returns the migrated session ID if migration occurred, null otherwise.
 */
export async function migrateLegacySession(): Promise<string | null> {
  // Skip if already migrated
  if (localStorage.getItem(MIGRATION_FLAG)) return null;

  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MIGRATION_FLAG, '1');
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed.uiMessages || !Array.isArray(parsed.uiMessages) || parsed.uiMessages.length <= 1) {
      localStorage.setItem(MIGRATION_FLAG, '1');
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return null;
    }

    const sessionId = crypto.randomUUID();
    // Derive title from first user text message
    const firstUserMsg = parsed.uiMessages.find(
      (m: { role: string; content: string }) => m.role === 'user' && m.content?.trim(),
    );
    const title = firstUserMsg?.content?.slice(0, 60) || 'Restored Session';

    const session: ChatSession = {
      id: sessionId,
      title,
      createdAt: parsed.savedAt || Date.now(),
      updatedAt: parsed.savedAt || Date.now(),
      uiMessages: parsed.uiMessages,
      conversation: parsed.conversation || [],
      allResultUrls: parsed.allResultUrls || [],
      analysisSuggestions: parsed.analysisSuggestions || [],
    };

    await saveSession(session);

    // Clean up legacy storage
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.setItem(MIGRATION_FLAG, '1');

    console.log('[CHAT HISTORY DB] Migrated legacy session:', sessionId);
    return sessionId;
  } catch (err) {
    console.error('[CHAT HISTORY DB] Legacy migration failed:', err);
    localStorage.setItem(MIGRATION_FLAG, '1');
    return null;
  }
}
