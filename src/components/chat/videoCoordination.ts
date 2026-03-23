/**
 * Global video coordination — ensures only one chat video plays at a time.
 * When a video starts playing, all other registered videos are paused
 * and the active video is unmuted.
 *
 * Shared between ChatVideoPlayer (final results), ProgressVideo (in-progress results),
 * and FullscreenMediaViewer (lightbox preview).
 */

/** Global registry of all chat video elements */
export const activeVideos = new Set<HTMLVideoElement>();

/** Whether the fullscreen media viewer is currently open.
 *  When true, inline chat videos should NOT auto-play. */
let _fullscreenOpen = false;

export function isFullscreenOpen(): boolean {
  return _fullscreenOpen;
}

export function setFullscreenOpen(open: boolean): void {
  _fullscreenOpen = open;
}

/** Videos whose next `play` event is from a programmatic auto-play,
 *  not a user click. Cleared after the first `play` event fires. */
const _pendingAutoPlay = new WeakSet<HTMLVideoElement>();

/** Mark a video as about to be auto-played. Call immediately before el.play(). */
export function markAutoPlay(el: HTMLVideoElement) {
  _pendingAutoPlay.add(el);
}

/** Check (and consume) whether this play event was from a programmatic auto-play. */
export function consumeAutoPlay(el: HTMLVideoElement): boolean {
  const was = _pendingAutoPlay.has(el);
  _pendingAutoPlay.delete(el);
  return was;
}

/** Pause every registered video except the one that just started playing */
export function pauseOtherVideos(current: HTMLVideoElement) {
  activeVideos.forEach((v) => {
    if (v !== current && !v.paused) v.pause();
  });
}

/** Pause ALL registered inline chat videos (e.g. when fullscreen viewer opens) */
export function pauseAllVideos() {
  activeVideos.forEach((v) => {
    if (!v.paused) v.pause();
  });
}
