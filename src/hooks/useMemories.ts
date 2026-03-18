/**
 * React hook for managing user memories (persistent preferences/facts).
 * Used by UI and manage_memory tool.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Memory } from '@/types/userData';
import {
  saveMemory,
  getAllMemories,
  deleteMemory as dbDeleteMemory,
  upsertMemoryByKey as dbUpsertMemoryByKey,
  deleteMemoryByKey,
} from '@/utils/userDataDB';

const BROADCAST_CHANNEL = 'sogni-memories-sync';

export interface UseMemoriesReturn {
  memories: Memory[];
  initialized: boolean;
  addMemory: (memory: Memory) => Promise<void>;
  updateMemory: (memory: Memory) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  upsertByKey: (key: string, value: string, category: Memory['category'], source: Memory['source']) => Promise<void>;
  deleteByKey: (key: string) => Promise<void>;
  refreshMemories: () => Promise<void>;
}

function notifyOtherTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL);
    channel.postMessage({ type: 'memories-updated' });
    channel.close();
  } catch { /* ignore */ }
}

export function useMemories(): UseMemoriesReturn {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [initialized, setInitialized] = useState(false);
  const mountedRef = useRef(true);

  const refreshMemories = useCallback(async () => {
    try {
      const all = await getAllMemories();
      if (mountedRef.current) {
        setMemories(all);
      }
    } catch (err) {
      console.error('[MEMORIES] Failed to load memories:', err);
    }
  }, []);

  // Init
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      await refreshMemories();
      if (mountedRef.current) setInitialized(true);
    })();
    return () => { mountedRef.current = false; };
  }, [refreshMemories]);

  // Same-tab sync (tool handler dispatches this after writing to IndexedDB)
  useEffect(() => {
    const handler = () => { refreshMemories(); };
    window.addEventListener('sogni-memories-updated', handler);
    return () => window.removeEventListener('sogni-memories-updated', handler);
  }, [refreshMemories]);

  // Cross-tab sync
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.onmessage = () => { refreshMemories(); };
    } catch { return; }
    return () => { try { channel.close(); } catch { /* ignore */ } };
  }, [refreshMemories]);

  const addMemory = useCallback(async (memory: Memory) => {
    await saveMemory(memory);
    await refreshMemories();
    notifyOtherTabs();
  }, [refreshMemories]);

  const updateMemory = useCallback(async (memory: Memory) => {
    await saveMemory(memory);
    await refreshMemories();
    notifyOtherTabs();
  }, [refreshMemories]);

  const deleteMemoryHandler = useCallback(async (id: string) => {
    await dbDeleteMemory(id);
    await refreshMemories();
    notifyOtherTabs();
  }, [refreshMemories]);

  const upsertByKey = useCallback(async (
    key: string,
    value: string,
    category: Memory['category'],
    source: Memory['source'],
  ) => {
    await dbUpsertMemoryByKey(key, value, category, source);
    await refreshMemories();
    notifyOtherTabs();
  }, [refreshMemories]);

  const deleteByKeyHandler = useCallback(async (key: string) => {
    await deleteMemoryByKey(key);
    await refreshMemories();
    notifyOtherTabs();
  }, [refreshMemories]);

  return {
    memories,
    initialized,
    addMemory,
    updateMemory,
    deleteMemory: deleteMemoryHandler,
    upsertByKey,
    deleteByKey: deleteByKeyHandler,
    refreshMemories,
  };
}
