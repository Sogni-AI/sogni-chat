/**
 * React hook for managing personas (named photo references).
 * Follows useChatSessions pattern: blob URL caching, BroadcastChannel sync.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Persona, PersonaSummary } from '@/types/userData';
import {
  savePersona,
  getAllPersonas,
  deletePersona as dbDeletePersona,
  getPersonaThumbnail,
  savePersonaThumbnail,
  generatePersonaThumbnail,
} from '@/utils/userDataDB';

const BROADCAST_CHANNEL = 'sogni-personas-sync';

export interface UsePersonasReturn {
  personas: PersonaSummary[];
  initialized: boolean;
  addPersona: (persona: Persona, faceCropBlob?: Blob | null) => Promise<void>;
  updatePersona: (persona: Persona, faceCropBlob?: Blob | null) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  getPersonaThumbnailUrl: (personaId: string) => Promise<string | null>;
  refreshPersonas: () => Promise<void>;
}

function notifyOtherTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL);
    channel.postMessage({ type: 'personas-updated' });
    channel.close();
  } catch { /* ignore */ }
}

export function usePersonas(): UsePersonasReturn {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [initialized, setInitialized] = useState(false);
  const blobUrlCacheRef = useRef<Map<string, string>>(new Map());
  const mountedRef = useRef(true);

  const refreshPersonas = useCallback(async () => {
    try {
      const summaries = await getAllPersonas();
      if (mountedRef.current) {
        setPersonas(summaries);
      }
    } catch (err) {
      console.error('[PERSONAS] Failed to load personas:', err);
    }
  }, []);

  // Init: load personas
  useEffect(() => {
    mountedRef.current = true;
    const cache = blobUrlCacheRef.current;

    (async () => {
      await refreshPersonas();
      if (mountedRef.current) setInitialized(true);
    })();

    return () => {
      mountedRef.current = false;
      // Revoke cached blob URLs
      cache.forEach(url => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, [refreshPersonas]);

  // Cross-tab sync
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.onmessage = () => { refreshPersonas(); };
    } catch { return; }
    return () => { try { channel.close(); } catch { /* ignore */ } };
  }, [refreshPersonas]);

  const addPersona = useCallback(async (persona: Persona, faceCropBlob?: Blob | null) => {
    await savePersona(persona);

    // Generate and save thumbnail — prefer face-cropped version for better avatars
    if (faceCropBlob || persona.photoData) {
      try {
        const sourceBlob = faceCropBlob || new Blob(
          [persona.photoData!.buffer.slice(persona.photoData!.byteOffset, persona.photoData!.byteOffset + persona.photoData!.byteLength) as ArrayBuffer],
          { type: persona.photoMimeType || 'image/jpeg' },
        );
        const thumbBlob = await generatePersonaThumbnail(sourceBlob);
        await savePersonaThumbnail({ personaId: persona.id, blob: thumbBlob });
      } catch (err) {
        console.warn('[PERSONAS] Failed to generate thumbnail:', err);
      }
    }

    await refreshPersonas();
    notifyOtherTabs();
  }, [refreshPersonas]);

  const updatePersona = useCallback(async (persona: Persona, faceCropBlob?: Blob | null) => {
    await savePersona(persona);

    // Regenerate thumbnail — prefer face-cropped version for better avatars
    if (faceCropBlob || persona.photoData) {
      try {
        const sourceBlob = faceCropBlob || new Blob(
          [persona.photoData!.buffer.slice(persona.photoData!.byteOffset, persona.photoData!.byteOffset + persona.photoData!.byteLength) as ArrayBuffer],
          { type: persona.photoMimeType || 'image/jpeg' },
        );
        const thumbBlob = await generatePersonaThumbnail(sourceBlob);
        await savePersonaThumbnail({ personaId: persona.id, blob: thumbBlob });
        // Invalidate cached blob URL
        const cached = blobUrlCacheRef.current.get(persona.id);
        if (cached) {
          URL.revokeObjectURL(cached);
          blobUrlCacheRef.current.delete(persona.id);
        }
      } catch (err) {
        console.warn('[PERSONAS] Failed to update thumbnail:', err);
      }
    }

    await refreshPersonas();
    notifyOtherTabs();
  }, [refreshPersonas]);

  const deletePersonaHandler = useCallback(async (id: string) => {
    await dbDeletePersona(id);
    // Revoke cached blob URL
    const cached = blobUrlCacheRef.current.get(id);
    if (cached) {
      URL.revokeObjectURL(cached);
      blobUrlCacheRef.current.delete(id);
    }
    await refreshPersonas();
    notifyOtherTabs();
  }, [refreshPersonas]);

  const getPersonaThumbnailUrl = useCallback(async (personaId: string): Promise<string | null> => {
    const cache = blobUrlCacheRef.current;
    const cached = cache.get(personaId);
    if (cached) return cached;

    const thumb = await getPersonaThumbnail(personaId);
    if (!thumb) return null;

    const url = URL.createObjectURL(thumb.blob);
    cache.set(personaId, url);
    return url;
  }, []);

  return {
    personas,
    initialized,
    addPersona,
    updatePersona,
    deletePersona: deletePersonaHandler,
    getPersonaThumbnailUrl,
    refreshPersonas,
  };
}
