/**
 * Utilities for fetching source media (images, audio) for tool execution.
 */

import type { UploadedFile } from '../types';

/**
 * Extract the first persona voice clip from uploaded files.
 * Returns a Blob suitable for SDK's referenceAudioIdentity parameter,
 * or null if no persona voice clip is present.
 *
 * Voice clips are injected by resolve_personas with filename prefix "persona-voiceclip-".
 */
export function getPersonaVoiceClip(uploadedFiles: UploadedFile[]): Blob | null {
  const voiceClipFile = uploadedFiles.find(
    f => f.type === 'audio' && f.filename?.startsWith('persona-voiceclip-'),
  );
  if (!voiceClipFile) return null;
  console.log(`[VOICE] Found persona voice clip: ${voiceClipFile.filename} (${(voiceClipFile.data.length / 1024).toFixed(1)}KB)`);
  return new Blob([voiceClipFile.data as BlobPart], { type: voiceClipFile.mimeType });
}

/**
 * Fetch an audio URL and return the raw bytes + detected MIME type.
 * Unlike the image variant this does a straightforward binary fetch
 * (no canvas needed).
 */
export async function fetchAudioAsUint8Array(
  url: string,
): Promise<{ data: Uint8Array; mimeType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Audio fetch failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('Audio fetch returned empty data');
    }
    return { data: new Uint8Array(buffer), mimeType: contentType };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch an image URL and convert to Uint8Array with dimensions.
 * Uses direct fetch (no canvas re-encode). Returns the actual MIME type
 * from the response so callers don't need to assume the format.
 */
export async function fetchImageAsUint8Array(
  url: string,
): Promise<{ data: Uint8Array; width: number; height: number; mimeType: string }> {
  const controller = new AbortController();
  // Single 30s deadline for the entire operation (image load + fetch)
  const deadline = setTimeout(() => controller.abort(), 30_000);

  try {
    // Get dimensions via Image element
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      controller.signal.addEventListener('abort', () => { img.src = ''; reject(new Error('Image fetch timed out')); });
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });

    // Fetch raw bytes directly — avoids canvas re-encode
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error('Image fetch returned empty data');

    return { data: new Uint8Array(buffer), width, height, mimeType };
  } finally {
    clearTimeout(deadline);
  }
}

