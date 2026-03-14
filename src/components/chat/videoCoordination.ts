/**
 * Global video coordination — ensures only one chat video plays at a time.
 * When a video starts playing, all other registered videos are paused
 * and the active video is unmuted.
 *
 * Shared between ChatVideoPlayer (final results) and ProgressVideo (in-progress results).
 */

/** Global registry of all chat video elements */
export const activeVideos = new Set<HTMLVideoElement>();

/** Pause every registered video except the one that just started playing */
export function pauseOtherVideos(current: HTMLVideoElement) {
  activeVideos.forEach((v) => {
    if (v !== current && !v.paused) v.pause();
  });
}
