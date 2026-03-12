/**
 * Unified file upload service — type detection, reading, and metadata extraction
 * for images, audio, and video files.
 */

import type { UploadedFile } from '@/tools/types';

// ---------------------------------------------------------------------------
// Accepted MIME types
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = {
  image: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heif', 'image/heic', 'image/avif'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/flac', 'audio/x-flac'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
} as const;

/** Extension-based fallback for MIME type detection */
const EXTENSION_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;    // 10 MB
const MEDIA_MAX_SIZE = 100 * 1024 * 1024;   // 100 MB

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

/** Detect the media type of a file from MIME type, falling back to extension. */
export function detectMediaType(file: File): 'image' | 'audio' | 'video' | null {
  const mime = file.type.toLowerCase();

  for (const [category, types] of Object.entries(ACCEPTED_TYPES)) {
    if ((types as readonly string[]).includes(mime)) {
      return category as 'image' | 'audio' | 'video';
    }
  }

  // Fallback: check extension
  const ext = getFileExtension(file.name);
  if (ext && ext in EXTENSION_MAP) {
    const resolvedMime = EXTENSION_MAP[ext];
    for (const [category, types] of Object.entries(ACCEPTED_TYPES)) {
      if ((types as readonly string[]).includes(resolvedMime)) {
        return category as 'image' | 'audio' | 'video';
      }
    }
  }

  return null;
}

/** Resolve the effective MIME type for a file (MIME or extension fallback). */
export function resolveEffectiveMime(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = getFileExtension(file.name);
  return (ext && EXTENSION_MAP[ext]) || file.type || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  mediaType?: 'image' | 'audio' | 'video';
}

/** Validate a file for upload — checks type and size. */
export function validateFile(file: File): FileValidationResult {
  const mediaType = detectMediaType(file);
  if (!mediaType) {
    return {
      valid: false,
      error: 'Unsupported file type. Accepted: images (JPG, PNG, WebP, HEIF, AVIF), audio (MP3, WAV, M4A, FLAC), video (MP4, WebM, MOV).',
    };
  }

  const maxSize = mediaType === 'image' ? IMAGE_MAX_SIZE : MEDIA_MAX_SIZE;
  if (file.size > maxSize) {
    const limitMB = (maxSize / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `File is too large. Maximum size for ${mediaType} files is ${limitMB}MB.`,
    };
  }

  return { valid: true, mediaType };
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

/** Read a file as Uint8Array. */
export async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Audio metadata
// ---------------------------------------------------------------------------

/** Get audio duration (in seconds) from a File. */
export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load audio file'));
    };
    audio.src = url;
  });
}

// ---------------------------------------------------------------------------
// Video metadata
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

/** Get video dimensions and duration from a File. */
export function getVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video file'));
    };
    video.preload = 'metadata';
    video.src = url;
  });
}

// ---------------------------------------------------------------------------
// Image metadata
// ---------------------------------------------------------------------------

/** Get image dimensions from a File. */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file'));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Build UploadedFile
// ---------------------------------------------------------------------------

/**
 * Process a raw File into an UploadedFile with metadata.
 * Reads the file data, detects type, and extracts relevant metadata
 * (dimensions for images/video, duration for audio/video).
 */
export async function processFile(file: File): Promise<UploadedFile> {
  const mediaType = detectMediaType(file);
  if (!mediaType) throw new Error('Unsupported file type');

  const mimeType = resolveEffectiveMime(file);
  const data = await readFileAsUint8Array(file);

  const base: Omit<UploadedFile, 'type'> = {
    data,
    mimeType,
    filename: file.name,
  };

  switch (mediaType) {
    case 'image': {
      const dims = await getImageDimensions(file);
      return { ...base, type: 'image', width: dims.width, height: dims.height };
    }
    case 'audio': {
      const duration = await getAudioDuration(file);
      return { ...base, type: 'audio', duration };
    }
    case 'video': {
      const meta = await getVideoMetadata(file);
      return { ...base, type: 'video', width: meta.width, height: meta.height, duration: meta.duration };
    }
  }
}

// ---------------------------------------------------------------------------
// Accept string (for <input> and drop zone)
// ---------------------------------------------------------------------------

/** Comma-separated accept string for all supported file types. */
export const ACCEPT_ALL_MEDIA = [
  ...ACCEPTED_TYPES.image,
  ...ACCEPTED_TYPES.audio,
  ...ACCEPTED_TYPES.video,
].join(',');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileExtension(filename: string): string | null {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex < 0) return null;
  return filename.slice(dotIndex).toLowerCase();
}
