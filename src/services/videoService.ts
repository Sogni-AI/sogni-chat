/**
 * Video service — utilities for video processing and playback.
 * Stub for now — implementations may be added when video features expand.
 */

export interface VideoGenerationOptions {
  prompt: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface VideoGenerationProgress {
  progress: number;
  etaSeconds?: number;
  status?: string;
}

interface GenerateVideoParams {
  imageUrl: string;
  width: number;
  height: number;
  tokenType: string;
}

/**
 * Generate a video from an image (stub).
 * The real implementation should use the animate_photo tool handler via Sogni SDK.
 * This is kept for the legacy useVideo hook interface.
 */
export async function generateVideo(
  _client: unknown,
  _params: GenerateVideoParams,
  _onProgress: (progress: VideoGenerationProgress) => void,
  _signal?: AbortSignal,
): Promise<string> {
  throw new Error('generateVideo stub — use the animate_photo tool via chat instead');
}

/** Convert a video URL to a blob URL for reliable playback */
export async function videoUrlToBlob(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/** Extract a poster frame from a video at a given time */
export async function extractPosterFrame(
  videoUrl: string,
  _timeSeconds: number = 0,
): Promise<string> {
  // Return the video URL itself as a fallback — proper frame extraction
  // requires a canvas-based approach that depends on video loading
  return videoUrl;
}
