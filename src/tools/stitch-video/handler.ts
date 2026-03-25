/**
 * Handler for stitch_video tool.
 * Concatenates multiple previously-generated video clips into a single continuous video.
 */

import type { ToolExecutionContext, ToolCallbacks } from '../types';
import { concatenateVideos } from '@/utils/videoConcatenation';
import { saveVideoToGallery } from '@/services/galleryService';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const rawIndices = args.videoIndices as unknown[];
  if (!Array.isArray(rawIndices) || rawIndices.length === 0) {
    return JSON.stringify({ error: 'invalid_args', message: 'videoIndices must be a non-empty array.' });
  }

  const indices = rawIndices.map(Number);
  if (indices.some(isNaN)) {
    return JSON.stringify({ error: 'invalid_args', message: 'All videoIndices must be valid numbers.' });
  }

  const videoUrls: string[] = [];
  const invalidIndices: number[] = [];
  for (const idx of indices) {
    const url = context.videoResultUrls[idx];
    if (url) {
      videoUrls.push(url);
    } else {
      invalidIndices.push(idx);
    }
  }

  if (invalidIndices.length > 0) {
    return JSON.stringify({
      error: 'invalid_indices',
      message: `Video indices not found: ${invalidIndices.join(', ')}. Available: 0-${context.videoResultUrls.length - 1}.`,
    });
  }

  if (videoUrls.length < 2) {
    return JSON.stringify({
      error: 'too_few_videos',
      message: 'Need at least 2 videos to stitch. Only found ' + videoUrls.length + '.',
    });
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'stitch_video',
    stepLabel: 'Stitching videos',
    totalCount: 1,
  });

  try {
    const blob = await concatenateVideos(videoUrls, (progress) => {
      callbacks.onToolProgress({
        type: 'progress',
        toolName: 'stitch_video',
        progress,
        stepLabel: 'Stitching videos',
      });
    });

    const blobUrl = URL.createObjectURL(blob);

    // Save to gallery (fire-and-forget)
    saveVideoToGallery({ videoBlob: blob })
      .then(({ galleryImageId }) => {
        callbacks.onGallerySaved?.([], [galleryImageId]);
      })
      .catch((err) => {
        console.error('[STITCH] Failed to save stitched video to gallery:', err);
      });

    callbacks.onToolComplete('stitch_video', [], [blobUrl]);

    return JSON.stringify({
      success: true,
      resultCount: 1,
      mediaType: 'video',
      message: `Successfully stitched ${videoUrls.length} videos into one continuous video.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[STITCH] Concatenation failed:', message);
    return JSON.stringify({ error: 'stitch_failed', message });
  }
}
