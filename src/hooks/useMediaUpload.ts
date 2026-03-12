/**
 * Unified media upload hook — single source of truth for all attached files.
 *
 * Handles images, audio, and video files. Images get blob URL previews for
 * thumbnails. Files persist across sends (not cleared automatically) and
 * can be restored from IndexedDB sessions via loadFiles().
 *
 * Max 6 image files (matching Flux.2's context image limit).
 */

import { useState, useCallback, useRef } from 'react';
import type { UploadedFile } from '@/tools/types';
import { validateFile, processFile } from '@/services/fileUpload';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of image files allowed (Flux.2 supports up to 6 context images) */
const MAX_IMAGE_FILES = 6;

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface UseMediaUploadReturn {
  /** All uploaded files (images, audio, video) */
  uploadedFiles: UploadedFile[];
  /** True while a file is being read/processed */
  isUploading: boolean;
  /** Last validation or processing error */
  error: string | null;
  /** Add a file — validates, reads, extracts metadata, appends to list */
  addFile: (file: File) => Promise<void>;
  /** Remove a file by index */
  removeFile: (index: number) => void;
  /** Clear all uploaded files */
  clearFiles: () => void;
  /** Replace all files (for session restoration) */
  loadFiles: (files: UploadedFile[]) => void;
  /** Get a blob URL preview for an image file at the given index, or null */
  getPreviewUrl: (index: number) => string | null;
  /** Dismiss the current error */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMediaUpload(): UseMediaUploadReturn {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache blob URLs keyed by a stable identifier (filename + byte length)
  // so the same file doesn't generate multiple URLs across renders.
  const previewUrlCacheRef = useRef<Map<string, string>>(new Map());

  /** Generate a stable cache key for an uploaded file */
  const fileCacheKey = (f: UploadedFile) => `${f.filename}:${f.data.byteLength}`;

  /** Revoke all cached blob URLs */
  const revokeAllUrls = useCallback(() => {
    previewUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlCacheRef.current.clear();
  }, []);

  /** Revoke a specific file's cached URL */
  const revokeUrl = useCallback((f: UploadedFile) => {
    const key = fileCacheKey(f);
    const url = previewUrlCacheRef.current.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      previewUrlCacheRef.current.delete(key);
    }
  }, []);

  const addFile = useCallback(async (file: File) => {
    setError(null);

    // Validate type and size
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    // Quick early-exit if image limit already reached (avoids unnecessary
    // processFile work). This is a best-effort check — the atomic guard below
    // is the authoritative one.
    if (validation.mediaType === 'image') {
      let limitExceeded = false;
      setUploadedFiles(prev => {
        if (prev.filter(f => f.type === 'image').length >= MAX_IMAGE_FILES) {
          limitExceeded = true;
        }
        return prev; // no mutation, just a read
      });
      if (limitExceeded) {
        setError(`Maximum ${MAX_IMAGE_FILES} images allowed.`);
        return;
      }
    }

    setIsUploading(true);
    try {
      const uploaded = await processFile(file);

      // Atomic check-and-append: if two addFile calls race through the early
      // check above, this updater ensures only one can push past the limit.
      let limitExceeded = false;
      setUploadedFiles(prev => {
        if (uploaded.type === 'image') {
          const currentImageCount = prev.filter(f => f.type === 'image').length;
          if (currentImageCount >= MAX_IMAGE_FILES) {
            limitExceeded = true;
            return prev; // reject — don't append
          }
        }
        return [...prev, uploaded];
      });

      if (limitExceeded) {
        setError(`Maximum ${MAX_IMAGE_FILES} images allowed.`);
        return;
      }

      console.log(
        `[MEDIA UPLOAD] Added ${uploaded.type}: ${uploaded.filename}`,
        uploaded.width ? `${uploaded.width}x${uploaded.height}` : '',
        uploaded.duration ? `${uploaded.duration.toFixed(1)}s` : '',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to process file';
      console.error('[MEDIA UPLOAD] Processing failed:', err);
      setError(message);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setUploadedFiles(prev => {
      if (index < 0 || index >= prev.length) return prev;
      // Revoke the blob URL for the removed file
      revokeUrl(prev[index]);
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setError(null);
  }, [revokeUrl]);

  const clearFiles = useCallback(() => {
    revokeAllUrls();
    setUploadedFiles([]);
    setError(null);
  }, [revokeAllUrls]);

  const loadFiles = useCallback((files: UploadedFile[]) => {
    revokeAllUrls();
    setUploadedFiles(files);
    setError(null);
  }, [revokeAllUrls]);

  const getPreviewUrl = useCallback((index: number): string | null => {
    const file = uploadedFiles[index];
    if (!file || file.type !== 'image') return null;

    const key = fileCacheKey(file);
    const cached = previewUrlCacheRef.current.get(key);
    if (cached) return cached;

    // Create blob URL from Uint8Array data
    const blob = new Blob([file.data as BlobPart], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    previewUrlCacheRef.current.set(key, url);
    return url;
  }, [uploadedFiles]);

  const clearError = useCallback(() => setError(null), []);

  return {
    uploadedFiles,
    isUploading,
    error,
    addFile,
    removeFile,
    clearFiles,
    loadFiles,
    getPreviewUrl,
    clearError,
  };
}
