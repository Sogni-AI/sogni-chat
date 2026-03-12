/**
 * Multi-type media upload hook — handles images, audio, and video files.
 *
 * Extends the single-image pattern from useImageUpload to support multiple
 * files of different media types, used by the chat input for sound_to_video,
 * video_to_video, and other multi-media tools.
 */

import { useState, useCallback } from 'react';
import type { UploadedFile } from '@/tools/types';
import { validateFile, processFile } from '@/services/fileUpload';

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
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMediaUpload(): UseMediaUploadReturn {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFile = useCallback(async (file: File) => {
    setError(null);

    // Validate type and size
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setIsUploading(true);
    try {
      const uploaded = await processFile(file);
      setUploadedFiles(prev => [...prev, uploaded]);
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
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setError(null);
  }, []);

  const clearFiles = useCallback(() => {
    setUploadedFiles([]);
    setError(null);
  }, []);

  return {
    uploadedFiles,
    isUploading,
    error,
    addFile,
    removeFile,
    clearFiles,
  };
}
