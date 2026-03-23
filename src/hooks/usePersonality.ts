/**
 * React hook for managing the user's custom LLM personality preference.
 * Singleton value persisted in IndexedDB, synced across tabs.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getPersonality,
  savePersonalityInstruction,
  clearPersonality as dbClearPersonality,
} from '@/utils/userDataDB';

const BROADCAST_CHANNEL = 'sogni-personality-sync';
const CUSTOM_EVENT = 'sogni-personality-updated';

function notifyOtherTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL);
    channel.postMessage({ type: 'personality-updated' });
    channel.close();
  } catch { /* ignore */ }
}

export interface UsePersonalityReturn {
  personality: string;
  initialized: boolean;
  savePersonality: (instruction: string) => Promise<void>;
  clearPersonality: () => Promise<void>;
}

export function usePersonality(): UsePersonalityReturn {
  const [personality, setPersonality] = useState('');
  const [initialized, setInitialized] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const pref = await getPersonality();
      if (mountedRef.current) {
        setPersonality(pref?.instruction ?? '');
      }
    } catch (err) {
      console.error('[PERSONALITY] Failed to load personality:', err);
    }
  }, []);

  // Init
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      await refresh();
      if (mountedRef.current) setInitialized(true);
    })();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  // Same-tab sync
  useEffect(() => {
    const handler = () => { refresh(); };
    window.addEventListener(CUSTOM_EVENT, handler);
    return () => window.removeEventListener(CUSTOM_EVENT, handler);
  }, [refresh]);

  // Cross-tab sync
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.onmessage = () => { refresh(); };
    } catch { return; }
    return () => { try { channel.close(); } catch { /* ignore */ } };
  }, [refresh]);

  const savePersonality = useCallback(async (instruction: string) => {
    await savePersonalityInstruction(instruction);
    await refresh();
    window.dispatchEvent(new Event(CUSTOM_EVENT));
    notifyOtherTabs();
  }, [refresh]);

  const clearPersonality = useCallback(async () => {
    await dbClearPersonality();
    await refresh();
    window.dispatchEvent(new Event(CUSTOM_EVENT));
    notifyOtherTabs();
  }, [refresh]);

  return {
    personality,
    initialized,
    savePersonality,
    clearPersonality,
  };
}
