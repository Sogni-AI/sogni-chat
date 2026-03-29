/**
 * User Data IndexedDB Wrapper
 *
 * Persists personas and memories in IndexedDB. Follows the singleton pattern
 * from chatHistoryDB.ts. Separate database from chat history so personas
 * survive history clears.
 */

import type { Persona, PersonaSummary, PersonaThumbnail, Memory, PersonalityPreference } from '@/types/userData';

const DB_NAME = 'sogni_user_data';
const DB_VERSION = 3;
const PERSONAS_STORE = 'personas';
const MEMORIES_STORE = 'memories';
const THUMBNAILS_STORE = 'persona_thumbnails';
const PERSONALITY_STORE = 'personality';

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
      console.error('[USER DATA DB] Failed to open database:', request.error);
      reject(new Error('Failed to open user data database'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      // Invalidate cached instance — the upgrade creates a new connection
      dbInstance = null;
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(PERSONAS_STORE)) {
        const store = db.createObjectStore(PERSONAS_STORE, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(MEMORIES_STORE)) {
        const store = db.createObjectStore(MEMORIES_STORE, { keyPath: 'id' });
        store.createIndex('key', 'key', { unique: true });
        store.createIndex('category', 'category', { unique: false });
      }

      if (!db.objectStoreNames.contains(THUMBNAILS_STORE)) {
        db.createObjectStore(THUMBNAILS_STORE, { keyPath: 'personaId' });
      }

      if (!db.objectStoreNames.contains(PERSONALITY_STORE)) {
        db.createObjectStore(PERSONALITY_STORE, { keyPath: 'id' });
      }
    };
  });
}

// ============================================================================
// Persona CRUD
// ============================================================================

/** Save or update a persona */
export async function savePersona(persona: Persona): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONAS_STORE, 'readwrite');
    tx.objectStore(PERSONAS_STORE).put(persona);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to save persona:', tx.error);
      reject(new Error('Failed to save persona'));
    };
  });
}

/** Get a full persona by ID */
export async function getPersona(id: string): Promise<Persona | null> {
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONAS_STORE, 'readonly');
    const request = tx.objectStore(PERSONAS_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[USER DATA DB] Failed to get persona:', request.error);
      reject(new Error('Failed to load persona'));
    };
  });
}

/** Get all personas as lightweight summaries, sorted by updatedAt descending */
export async function getAllPersonas(): Promise<PersonaSummary[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONAS_STORE, 'readonly');
    const store = tx.objectStore(PERSONAS_STORE);
    const summaries: PersonaSummary[] = [];
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const p = cursor.value as Persona;
        summaries.push({
          id: p.id,
          name: p.name,
          relationship: p.relationship,
          description: p.description,
          tags: p.tags,
          hasPhoto: !!p.photoData,
          voice: p.voice || null,
          hasVoiceClip: !!(p.voiceClipData && p.voiceClipData.length > 0),
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        });
        cursor.continue();
      } else {
        summaries.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(summaries);
      }
    };

    request.onerror = () => {
      console.error('[USER DATA DB] Failed to get personas:', request.error);
      reject(new Error('Failed to load personas'));
    };
  });
}

/** Pronouns/words that implicitly refer to a persona by relationship */
const SELF_PRONOUNS = new Set(['me', 'myself']);
const PARTNER_PRONOUNS = new Set(['my wife', 'my husband', 'my partner', 'my spouse']);
const CHILD_PRONOUNS = new Set(['my son', 'my daughter', 'my kid', 'my child', 'my baby']);
const FRIEND_PRONOUNS = new Set(['my friend', 'my buddy', 'my bestie', 'my roommate']);
const PET_PRONOUNS = new Set(['my dog', 'my cat', 'my pet', 'my puppy', 'my kitten']);
const RELATIONSHIP_PRONOUNS: Record<string, Set<string>> = {
  self: SELF_PRONOUNS,
  partner: PARTNER_PRONOUNS,
  child: CHILD_PRONOUNS,
  friend: FRIEND_PRONOUNS,
  pet: PET_PRONOUNS,
};

/** Get full personas by name, nickname/tag, or implicit pronoun (case-insensitive match) */
export async function getPersonasByNames(names: string[]): Promise<Persona[]> {
  const db = await openDB();
  const lowerNames = new Set(names.map(n => n.toLowerCase()));

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONAS_STORE, 'readonly');
    const store = tx.objectStore(PERSONAS_STORE);
    const results: Persona[] = [];
    const matched = new Set<string>(); // Prevent duplicates if name + tag both match
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const p = cursor.value as Persona;
        if (matched.has(p.id)) { cursor.continue(); return; }
        // Match by name
        if (lowerNames.has(p.name.toLowerCase())) {
          results.push(p);
          matched.add(p.id);
        } else if (p.tags?.some(tag => lowerNames.has(tag.toLowerCase()))) {
          // Match by nickname/tag
          results.push(p);
          matched.add(p.id);
        } else {
          // Match by implicit relationship pronouns (e.g. "me" → self persona)
          const pronouns = RELATIONSHIP_PRONOUNS[p.relationship];
          if (pronouns && [...lowerNames].some(n => pronouns.has(n))) {
            results.push(p);
            matched.add(p.id);
          }
        }
        cursor.continue();
      } else {
        // Sort by relationship order: self first, partner second, then others
        const ORDER: Record<string, number> = { self: 0, partner: 1 };
        results.sort((a, b) => (ORDER[a.relationship] ?? 2) - (ORDER[b.relationship] ?? 2));
        resolve(results);
      }
    };

    request.onerror = () => {
      console.error('[USER DATA DB] Failed to query personas by name:', request.error);
      reject(new Error('Failed to query personas'));
    };
  });
}

/** Delete a persona and its thumbnail */
export async function deletePersona(id: string): Promise<void> {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PERSONAS_STORE, THUMBNAILS_STORE], 'readwrite');
    tx.objectStore(PERSONAS_STORE).delete(id);
    tx.objectStore(THUMBNAILS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to delete persona:', tx.error);
      reject(new Error('Failed to delete persona'));
    };
  });
}

// ============================================================================
// Persona Thumbnail Operations
// ============================================================================

/** Save a persona thumbnail */
export async function savePersonaThumbnail(thumbnail: PersonaThumbnail): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, 'readwrite');
    tx.objectStore(THUMBNAILS_STORE).put(thumbnail);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to save persona thumbnail:', tx.error);
      reject(new Error('Failed to save persona thumbnail'));
    };
  });
}

/** Get a persona thumbnail */
export async function getPersonaThumbnail(personaId: string): Promise<PersonaThumbnail | null> {
  if (!personaId) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, 'readonly');
    const request = tx.objectStore(THUMBNAILS_STORE).get(personaId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[USER DATA DB] Failed to get persona thumbnail:', request.error);
      reject(new Error('Failed to load persona thumbnail'));
    };
  });
}

/** Generate a square JPEG thumbnail from a Blob using canvas (160px for retina displays) */
export function generatePersonaThumbnail(blob: Blob, maxWidth = 160): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width === 0 || img.height === 0) {
        reject(new Error('Invalid image dimensions'));
        return;
      }
      // Center-crop to square, then scale to maxWidth (ensures good circular avatar display)
      const cropSize = Math.min(img.width, img.height);
      const sx = Math.round((img.width - cropSize) / 2);
      const sy = Math.round((img.height - cropSize) / 2);
      const outSize = Math.min(maxWidth, cropSize);

      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, outSize, outSize);
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
// Memory CRUD
// ============================================================================

/** Save or update a memory */
export async function saveMemory(memory: Memory): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORIES_STORE, 'readwrite');
    tx.objectStore(MEMORIES_STORE).put(memory);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to save memory:', tx.error);
      reject(new Error('Failed to save memory'));
    };
  });
}

/** Get all memories, sorted by updatedAt descending */
export async function getAllMemories(): Promise<Memory[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORIES_STORE, 'readonly');
    const store = tx.objectStore(MEMORIES_STORE);
    const memories: Memory[] = [];
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        memories.push(cursor.value as Memory);
        cursor.continue();
      } else {
        memories.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(memories);
      }
    };

    request.onerror = () => {
      console.error('[USER DATA DB] Failed to get memories:', request.error);
      reject(new Error('Failed to load memories'));
    };
  });
}

/** Find a memory by key */
export async function getMemoryByKey(key: string): Promise<Memory | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORIES_STORE, 'readonly');
    const store = tx.objectStore(MEMORIES_STORE);
    const index = store.index('key');
    const request = index.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[USER DATA DB] Failed to get memory by key:', request.error);
      reject(new Error('Failed to load memory'));
    };
  });
}

/** Delete a memory by ID */
export async function deleteMemory(id: string): Promise<void> {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORIES_STORE, 'readwrite');
    tx.objectStore(MEMORIES_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to delete memory:', tx.error);
      reject(new Error('Failed to delete memory'));
    };
  });
}

/**
 * Atomic upsert: find-or-create a memory by key within a single readwrite
 * transaction, preventing the ConstraintError race where two concurrent calls
 * both read `null` and then both try to insert with different IDs.
 */
export async function upsertMemoryByKey(
  key: string,
  value: string,
  category: Memory['category'],
  source: Memory['source'],
): Promise<{ memory: Memory; created: boolean }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORIES_STORE, 'readwrite');
    const store = tx.objectStore(MEMORIES_STORE);
    const index = store.index('key');
    const getRequest = index.get(key);

    getRequest.onsuccess = () => {
      const existing = getRequest.result as Memory | undefined;
      const now = Date.now();
      const created = !existing;
      const memory: Memory = existing
        ? { ...existing, value, category, source, updatedAt: now }
        : { id: crypto.randomUUID(), key, value, category, source, createdAt: now, updatedAt: now };

      store.put(memory);
      // Resolve on transaction complete so we know the write committed
      tx.oncomplete = () => resolve({ memory, created });
    };

    getRequest.onerror = () => {
      console.error('[USER DATA DB] Failed to read memory by key during upsert:', getRequest.error);
      reject(new Error('Failed to upsert memory'));
    };

    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to upsert memory:', tx.error);
      reject(new Error('Failed to upsert memory'));
    };
  });
}

/** Delete a memory by key */
export async function deleteMemoryByKey(key: string): Promise<void> {
  const memory = await getMemoryByKey(key);
  if (memory) {
    await deleteMemory(memory.id);
  }
}

// ============================================================================
// Personality CRUD
// ============================================================================

const PERSONALITY_ID = 'default';

/** Get the user's personality preference (singleton) */
export async function getPersonality(): Promise<PersonalityPreference | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONALITY_STORE, 'readonly');
    const request = tx.objectStore(PERSONALITY_STORE).get(PERSONALITY_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[USER DATA DB] Failed to get personality:', request.error);
      reject(new Error('Failed to load personality'));
    };
  });
}

/** Save or update the user's personality instruction */
export async function savePersonalityInstruction(instruction: string): Promise<PersonalityPreference> {
  const db = await openDB();
  const pref: PersonalityPreference = {
    id: PERSONALITY_ID,
    instruction,
    updatedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONALITY_STORE, 'readwrite');
    tx.objectStore(PERSONALITY_STORE).put(pref);
    tx.oncomplete = () => resolve(pref);
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to save personality:', tx.error);
      reject(new Error('Failed to save personality'));
    };
  });
}

/** Clear the user's personality instruction (revert to default) */
export async function clearPersonality(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERSONALITY_STORE, 'readwrite');
    tx.objectStore(PERSONALITY_STORE).delete(PERSONALITY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[USER DATA DB] Failed to clear personality:', tx.error);
      reject(new Error('Failed to clear personality'));
    };
  });
}
