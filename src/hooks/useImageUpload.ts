import { useState, useCallback, useEffect } from 'react';
import { validateImageFile, fileToUint8Array, createImageUrl, revokeImageUrl, transcodeIfNeeded, downsampleIfOversized } from '../utils/imageProcessing';

/* ── IndexedDB persistence for chat image ── */
const IDB_NAME = 'sogni_chat_image';
const IDB_STORE = 'image';

function openImageDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function saveImageToIDB(data: Uint8Array, width: number, height: number) {
  try {
    const db = await openImageDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put(data, 'imageData');
    store.put(width, 'width');
    store.put(height, 'height');
  } catch (err) {
    console.error('[UPLOAD] Failed to persist image:', err);
  }
}

async function loadImageFromIDB(): Promise<{ imageData: Uint8Array; width: number; height: number } | null> {
  try {
    const db = await openImageDB();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const [data, w, h] = await Promise.all([
      idbGet<Uint8Array>(store, 'imageData'),
      idbGet<number>(store, 'width'),
      idbGet<number>(store, 'height'),
    ]);
    if (!data || !w || !h) return null;
    return { imageData: data, width: w, height: h };
  } catch {
    return null;
  }
}

/** Clear persisted image. Exported for use by ChatPage on "New Photo". */
export async function clearStoredImage() {
  try {
    const db = await openImageDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
  } catch { /* ignore IndexedDB clear errors */ }
}

/* ── Hook ── */

interface UseImageUploadOptions {
  /** Persist image to IndexedDB so it survives page refresh (default: false) */
  persist?: boolean;
}

interface UseImageUploadResult {
  file: File | null;
  imageUrl: string | null;
  imageData: Uint8Array | null;
  width: number;
  height: number;
  error: string | null;
  upload: (file: File) => Promise<void>;
  clear: () => void;
  /** Programmatically load image data (for restoring a saved session) */
  loadFromData: (data: Uint8Array, w: number, h: number) => Promise<void>;
}

export function useImageUpload(options?: UseImageUploadOptions): UseImageUploadResult {
  const persist = options?.persist ?? false;
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageData, setImageData] = useState<Uint8Array | null>(null);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [error, setError] = useState<string | null>(null);

  // Restore from IndexedDB on mount (only when persist is enabled).
  // The image IDB store is a page-refresh cache — it should only restore if there's
  // a matching active session in sessionStorage (which is also per-tab, refresh-safe).
  // Without a session, the persisted image is orphaned from a previous tab/browser
  // session and would cause duplicate auto-analysis. Clear it instead.
  useEffect(() => {
    if (!persist) return;
    const hasActiveSession = !!sessionStorage.getItem('sogni_chat_active_session');
    if (!hasActiveSession) {
      clearStoredImage();
      return;
    }
    loadImageFromIDB().then((stored) => {
      if (stored) {
        const blob = new Blob([stored.imageData as BlobPart], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setImageData(stored.imageData);
        setImageUrl(url);
        setWidth(stored.width);
        setHeight(stored.height);
      }
    });
  }, [persist]);

  const upload = useCallback(async (uploadedFile: File) => {
    setError(null);

    // Validate file
    const validation = validateImageFile(uploadedFile);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    try {
      // Transcode if needed (WebP/HEIF/HEIC → JPEG), also returns dimensions
      const transcoded = await transcodeIfNeeded(uploadedFile);
      // Downsample if either dimension exceeds SDK limit (2048px)
      const { file: processedFile, width: w, height: h } = await downsampleIfOversized(
        transcoded.file, transcoded.width, transcoded.height,
      );
      setWidth(w);
      setHeight(h);

      // Create preview URL
      const url = createImageUrl(processedFile);
      setImageUrl(url);

      // Convert to Uint8Array
      const data = await fileToUint8Array(processedFile);
      setImageData(data);

      setFile(processedFile);

      // Persist to IndexedDB (chat session only)
      if (persist) saveImageToIDB(data, w, h);
    } catch (err: any) {
      console.error('[UPLOAD] Failed to process image:', err);
      setError(err.message || 'Failed to process image');
    }
  }, []);

  const clear = useCallback(() => {
    if (imageUrl) {
      revokeImageUrl(imageUrl);
    }
    setFile(null);
    setImageUrl(null);
    setImageData(null);
    setWidth(1024);
    setHeight(1024);
    setError(null);
    if (persist) clearStoredImage();
  }, [imageUrl, persist]);

  /** Programmatically load image data (for restoring a saved session) */
  const loadFromData = useCallback(async (data: Uint8Array, w: number, h: number) => {
    // Revoke previous URL if any
    if (imageUrl) revokeImageUrl(imageUrl);

    const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });

    // Defensive: downsample if persisted data predates the 2048px limit
    const tempFile = new File([blob], 'restored.jpg', { type: 'image/jpeg' });
    const { file: finalFile, width: fw, height: fh } = await downsampleIfOversized(tempFile, w, h);

    const url = URL.createObjectURL(finalFile);
    const finalData = fw !== w || fh !== h ? new Uint8Array(await finalFile.arrayBuffer()) : data;
    setImageData(finalData);
    setImageUrl(url);
    setWidth(fw);
    setHeight(fh);
    setFile(null);
    setError(null);
    if (persist) saveImageToIDB(finalData, fw, fh);
  }, [imageUrl, persist]);

  return {
    file,
    imageUrl,
    imageData,
    width,
    height,
    error,
    upload,
    clear,
    loadFromData,
  };
}
