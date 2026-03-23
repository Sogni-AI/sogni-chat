/**
 * useChatSessions Hook
 *
 * Manages the list of chat sessions for the sidebar. Handles CRUD operations,
 * thumbnail blob URL caching, cross-tab sync, and legacy migration.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatSession, ChatSessionSummary } from '@/types/chat';
import {
  getAllSessions,
  getSession,
  saveSession,
  deleteSession as dbDeleteSession,
  updateSessionFields,
  saveThumbnail,
  getThumbnail,
  generateThumbnail,
  migrateLegacySession,
} from '@/utils/chatHistoryDB';
const BROADCAST_CHANNEL = 'sogni-chat-sessions-sync';
const ACTIVE_SESSION_KEY = 'sogni_chat_active_session';

export interface UseChatSessionsReturn {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  createNewSession: () => string;
  switchSession: (id: string) => Promise<ChatSession | null>;
  deleteSessionById: (id: string) => Promise<void>;
  saveCurrentSession: (id: string, session: ChatSession) => Promise<void>;
  getThumbnailUrl: (sessionId: string) => Promise<string | null>;
  updateThumbnail: (sessionId: string, imageBlob: Blob) => Promise<void>;
  refreshSessions: () => Promise<void>;
  renameSession: (id: string, newTitle: string) => Promise<void>;
  togglePinSession: (id: string) => Promise<boolean>;
  /** True once init (migration + session restore) has completed */
  initialized: boolean;
  /** The session to restore on mount (set once during init, consumed by parent) */
  pendingRestore: ChatSession | null;
  /** Clear the pending restore after parent has consumed it */
  clearPendingRestore: () => void;
}

const BACKFILL_CLEANUP_KEY = 'sogni_chat_backfill_cleaned_v2';

/**
 * One-time migration: strip all incorrectly backfilled gallery IDs from ALL sessions.
 * The timestamp-based backfill matched gallery projects from unrelated sessions
 * and the /restore page, causing wrong images/videos to appear in old chats.
 * Gallery IDs are now only set via forward-tracking (onGallerySaved/setGalleryIds).
 */
async function cleanupStaleBackfill(): Promise<void> {
  try {
    if (localStorage.getItem(BACKFILL_CLEANUP_KEY)) return;
  } catch { /* ignore */ }

  try {
    // Never strip gallery IDs from the currently active session —
    // it may have legitimate forward-tracked IDs from an in-progress or just-completed batch.
    let activeId: string | null = null;
    try { activeId = sessionStorage.getItem(ACTIVE_SESSION_KEY); } catch { /* ignore */ }

    const summaries = await getAllSessions();
    let cleaned = 0;

    for (const summary of summaries) {
      if (summary.id === activeId) continue; // protect current session

      const session = await getSession(summary.id);
      if (!session) continue;

      const hasStaleIds = session.uiMessages.some(
        (m) => (m.galleryImageIds && m.galleryImageIds.length > 0) ||
               (m.galleryVideoIds && m.galleryVideoIds.length > 0),
      );
      if (!hasStaleIds) continue;

      const updatedMessages = session.uiMessages.map((msg) => {
        if (!msg.galleryImageIds && !msg.galleryVideoIds) return msg;
        return { ...msg, galleryImageIds: undefined, galleryVideoIds: undefined };
      });
      await saveSession({ ...session, uiMessages: updatedMessages });
      cleaned++;
    }

    if (cleaned > 0) {
      console.log(`[CHAT SESSIONS] Cleaned stale gallery backfill from ${cleaned} sessions`);
    }

    try { localStorage.setItem(BACKFILL_CLEANUP_KEY, '1'); } catch { /* ignore */ }
  } catch (err) {
    console.error('[CHAT SESSIONS] Gallery backfill cleanup failed:', err);
  }
}

function notifyOtherTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL);
    channel.postMessage({ type: 'sessions-updated' });
    channel.close();
  } catch { /* ignore */ }
}

export function useChatSessions(): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, _setActiveSessionId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<ChatSession | null>(null);

  // Persist active session ID to sessionStorage so it survives page refresh
  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_SESSION_KEY, id);
      else sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch { /* ignore */ }
  }, []);

  // Blob URL cache for thumbnails
  const blobUrlCacheRef = useRef<Map<string, string>>(new Map());

  const loadSessions = useCallback(async () => {
    try {
      const all = await getAllSessions();
      setSessions(all);
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to load sessions:', err);
    }
  }, []);

  // Init: migrate legacy, restore last active session, load sessions list
  useEffect(() => {
    let mounted = true;
    (async () => {
      // 1. Migrate legacy localStorage data if present
      const migratedId = await migrateLegacySession();
      if (!mounted) return;

      // 2. One-time cleanup of incorrectly backfilled gallery IDs
      await cleanupStaleBackfill();
      if (!mounted) return;

      // 3. Load all sessions for the sidebar
      await loadSessions();
      if (!mounted) return;

      // 4. Determine which session to restore
      const restoreId = migratedId || sessionStorage.getItem(ACTIVE_SESSION_KEY);
      if (restoreId) {
        let session = await getSession(restoreId);

        // Recover from emergency sessionStorage backup written by beforeunload.
        // If the backup has more messages or results than IndexedDB, the last
        // async save was interrupted by page unload — merge the backup.
        if (session) {
          try {
            const backupRaw = sessionStorage.getItem('sogni_session_backup');
            if (backupRaw) {
              sessionStorage.removeItem('sogni_session_backup');
              const backup = JSON.parse(backupRaw);
              if (
                backup.id === session.id &&
                Array.isArray(backup.uiMessages) &&
                Array.isArray(backup.allResultUrls)
              ) {
                const backupHasMore =
                  backup.uiMessages.length > session.uiMessages.length ||
                  backup.allResultUrls.length > session.allResultUrls.length;
                if (backupHasMore) {
                  console.log(`[CHAT SESSIONS] Recovering from emergency backup: ${backup.uiMessages.length} msgs (was ${session.uiMessages.length}), ${backup.allResultUrls.length} urls (was ${session.allResultUrls.length})`);
                  session = {
                    ...session,
                    uiMessages: backup.uiMessages,
                    conversation: backup.conversation,
                    allResultUrls: backup.allResultUrls,
                    audioResultUrls: backup.audioResultUrls || session.audioResultUrls,
                    analysisSuggestions: backup.analysisSuggestions || session.analysisSuggestions,
                    sessionModel: backup.sessionModel || session.sessionModel,
                    updatedAt: backup.timestamp || session.updatedAt,
                  };
                  await saveSession(session);
                }
              }
            }
          } catch (err) {
            console.warn('[CHAT SESSIONS] Failed to process emergency backup:', err);
          }
        }

        if (session && mounted) {
          const msgsWithImages = session.uiMessages.filter((m: any) => m.imageResults?.length);
          const msgsWithVideos = session.uiMessages.filter((m: any) => m.videoResults?.length);
          const totalVideoUrls = session.uiMessages.reduce((n: number, m: any) => n + (m.videoResults?.length || 0), 0);
          const msgsWithGalleryIds = session.uiMessages.filter((m: any) => m.galleryVideoIds?.length);
          console.log(`[CHAT SESSIONS] Restoring session ${restoreId}: ${session.uiMessages.length} msgs, ${msgsWithImages.length} with images, ${msgsWithVideos.length} with videos (${totalVideoUrls} urls), ${msgsWithGalleryIds.length} with gallery video IDs, hasImageData=${!!session.imageData}, ${session.allResultUrls.length} allResultUrls`);
          _setActiveSessionId(restoreId);
          try { sessionStorage.setItem(ACTIVE_SESSION_KEY, restoreId); } catch { /* ignore */ }
          setPendingRestore(session);
        } else {
          console.log(`[CHAT SESSIONS] Session ${restoreId} not found in IndexedDB`);
        }
      }

      if (mounted) setInitialized(true);
    })();
    return () => { mounted = false; };
  }, [loadSessions]);

  // Cross-tab sync
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.onmessage = () => { loadSessions(); };
    } catch { return; }
    return () => { try { channel.close(); } catch { /* ignore */ } };
  }, [loadSessions]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    const cache = blobUrlCacheRef.current;
    return () => {
      Array.from(cache.values()).forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const createNewSession = useCallback((): string => {
    return crypto.randomUUID();
  }, []);

  const switchSession = useCallback(async (id: string): Promise<ChatSession | null> => {
    try {
      const session = await getSession(id);
      if (session) {
        setActiveSessionId(id);
      }
      return session;
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to switch session:', err);
      return null;
    }
  }, [setActiveSessionId]);

  const deleteSessionById = useCallback(async (id: string) => {
    try {
      await dbDeleteSession(id);

      // Revoke cached blob URL
      const cache = blobUrlCacheRef.current;
      const cached = cache.get(id);
      if (cached) {
        URL.revokeObjectURL(cached);
        cache.delete(id);
      }

      await loadSessions();
      notifyOtherTabs();
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to delete session:', err);
    }
  }, [loadSessions]);

  const saveCurrentSession = useCallback(async (_id: string, session: ChatSession) => {
    try {
      await saveSession(session);
      await loadSessions();
      notifyOtherTabs();
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to save session:', err);
    }
  }, [loadSessions]);

  const getThumbnailUrl = useCallback(async (sessionId: string): Promise<string | null> => {
    const cache = blobUrlCacheRef.current;
    const cached = cache.get(sessionId);
    if (cached) return cached;

    try {
      const thumb = await getThumbnail(sessionId);
      if (!thumb) return null;
      const url = URL.createObjectURL(thumb.blob);
      cache.set(sessionId, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  const updateThumbnail = useCallback(async (sessionId: string, imageBlob: Blob) => {
    try {
      const thumbBlob = await generateThumbnail(imageBlob);
      await saveThumbnail({ sessionId, blob: thumbBlob });

      // Update cache
      const cache = blobUrlCacheRef.current;
      const old = cache.get(sessionId);
      if (old) URL.revokeObjectURL(old);
      cache.set(sessionId, URL.createObjectURL(thumbBlob));

      // Refresh sessions so ChatHistoryItem re-renders and picks up the cached thumbnail
      await loadSessions();
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to update thumbnail:', err);
    }
  }, [loadSessions]);

  const refreshSessions = useCallback(async () => {
    await loadSessions();
  }, [loadSessions]);

  const renameSession = useCallback(async (id: string, newTitle: string) => {
    try {
      await updateSessionFields(id, { title: newTitle });
      await loadSessions();
      notifyOtherTabs();
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to rename session:', err);
    }
  }, [loadSessions]);

  const togglePinSession = useCallback(async (id: string): Promise<boolean> => {
    try {
      // Read current state from IndexedDB (authoritative) to avoid stale closure
      const session = await getSession(id);
      if (!session) return false;
      const newPinned = !session.pinned;
      await updateSessionFields(id, { pinned: newPinned });
      await loadSessions();
      notifyOtherTabs();
      return newPinned;
    } catch (err) {
      console.error('[CHAT SESSIONS] Failed to toggle pin:', err);
      return false;
    }
  }, [loadSessions]);

  const clearPendingRestore = useCallback(() => {
    setPendingRestore(null);
  }, []);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createNewSession,
    switchSession,
    deleteSessionById,
    saveCurrentSession,
    getThumbnailUrl,
    updateThumbnail,
    refreshSessions,
    renameSession,
    togglePinSession,
    initialized,
    pendingRestore,
    clearPendingRestore,
  };
}
