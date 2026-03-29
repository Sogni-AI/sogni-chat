/**
 * Inline video results displayed within chat messages.
 *
 * Single video: custom inline player with play/pause, progress bar, mute, and
 * fullscreen controls. Does NOT use native <video controls> to prevent
 * auto-fullscreen on mobile — playsInline keeps video in-page.
 *
 * Multiple videos (grid): thumbnail cards showing first frame with a play-button
 * overlay. Tapping a card opens the fullscreen media viewer instead of playing
 * inline — this prevents layout overflow (especially with 9:16 portrait batches)
 * and gives each video a clear, large tap target.
 *
 * Prefers gallery blob URLs (persistent) over remote URLs (may expire).
 * Shows an "expired" state if the video fails to load.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGalleryBlobUrls } from '@/hooks/useGalleryBlobUrls';
import { activeVideos, pauseOtherVideos, isFullscreenOpen, markAutoPlay, consumeAutoPlay, formatETA } from './videoCoordination';
import { triggerRetry } from '@/services/retryBus';

/** Shared style for custom video control buttons */
const videoControlBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '0.25rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.9,
  outline: 'none',
  flexShrink: 0,
};

/** Individual video player with custom controls (play/pause, progress, mute, fullscreen).
 *  Uses playsInline to prevent auto-fullscreen on mobile. Native controls are replaced
 *  with a lightweight overlay that coordinates with the global video playback system.
 *  Click/tap on the video toggles play/pause. Controls auto-hide after 3s during playback
 *  and reappear on hover (desktop) or when paused. */
function ChatVideoPlayer({ src, onError, onPlay, aspectRatio, fillWidth, autoPlay = true }: { src: string; onError: () => void; onPlay?: () => void; aspectRatio?: string; fillWidth?: boolean; autoPlay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Compute placeholder dimensions that fit within maxWidth × maxHeight
  // while maintaining the aspect ratio (CSS alone can't handle both constraints).
  // Only used in standalone mode — grid mode uses width:100% + aspect-ratio instead.
  const placeholderSize = useMemo(() => {
    if (fillWidth) return null;
    const maxW = 360; // matches container maxWidth
    const maxH = 400; // matches video maxHeight
    const parts = (aspectRatio || '16 / 9').split('/').map(s => parseFloat(s.trim()));
    const ratio = (parts[0] && parts[1]) ? parts[0] / parts[1] : 16 / 9;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { width: w, height: h };
  }, [aspectRatio, fillWidth]);

  /** Check whether another registered chat video is currently playing */
  const isAnotherVideoPlaying = useCallback((el: HTMLVideoElement) => {
    for (const v of activeVideos) {
      if (v !== el && !v.paused) return true;
    }
    return false;
  }, []);

  /** Auto-hide controls after 3s of playback; re-show on mouse move */
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const el = videoRef.current;
      if (el && !el.paused) setShowControls(false);
    }, 3000);
  }, []);

  // Register video element, wire coordination + UI state tracking
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    activeVideos.add(el);

    const handlePlay = () => {
      if (consumeAutoPlay(el)) {
        // Auto-play: don't interrupt a video the user is already watching.
        // If another video is playing, pause self instead of stealing focus.
        for (const v of activeVideos) {
          if (v !== el && !v.paused) {
            el.pause();
            return;
          }
        }
        // Auto-play allowed — stay muted so the preview plays silently
        pauseOtherVideos(el);
        return;
      }
      // User-initiated play: pause others, unmute, notify parent
      pauseOtherVideos(el);
      if (el.muted) el.muted = false;
      onPlayRef.current?.();
    };

    const handlePlayState = () => setPlaying(true);
    const handlePauseState = () => { setPlaying(false); setShowControls(true); };
    const handleVolumeChange = () => setIsMuted(el.muted);
    const handleTimeUpdate = () => {
      if (el.duration) setCurrentProgress(el.currentTime / el.duration);
    };

    el.addEventListener('play', handlePlay);
    el.addEventListener('play', handlePlayState);
    el.addEventListener('pause', handlePauseState);
    el.addEventListener('volumechange', handleVolumeChange);
    el.addEventListener('timeupdate', handleTimeUpdate);

    // Pause video when scrolled out of view
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && !el.paused) {
          el.pause();
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);

    return () => {
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('play', handlePlayState);
      el.removeEventListener('pause', handlePauseState);
      el.removeEventListener('volumechange', handleVolumeChange);
      el.removeEventListener('timeupdate', handleTimeUpdate);
      activeVideos.delete(el);
      observer.disconnect();
    };
  }, []);

  // Track fullscreen state for container styling
  useEffect(() => {
    const handleFsChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // Clean up hide timer on unmount
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  // Start auto-hide timer when playback begins
  useEffect(() => { if (playing) resetHideTimer(); }, [playing, resetHideTimer]);

  // Reset ready state when src changes
  useEffect(() => {
    setReady(false);
  }, [src]);

  /** Programmatic auto-play: only plays if no fullscreen viewer is open
   *  and no other inline video is already playing. This prevents the
   *  chaotic multi-video-play when a batch of videos finish loading. */
  const handleLoadedData = useCallback(() => {
    setReady(true);
    const el = videoRef.current;
    if (!el || !autoPlay) return;
    // Suppress auto-play when the fullscreen viewer is open or another video is already playing
    if (isFullscreenOpen() || isAnotherVideoPlaying(el)) {
      return;
    }
    markAutoPlay(el);
    el.play().catch(() => { /* browser may block autoplay — that's fine */ });
  }, [autoPlay, isAnotherVideoPlaying]);

  /** Force the video to show and attempt play — used when user clicks the loading placeholder */
  const handlePlaceholderClick = useCallback(() => {
    setReady(true);
    const el = videoRef.current;
    if (!el) return;
    el.play().catch(() => { /* browser may block — that's fine */ });
  }, []);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setCurrentProgress(ratio);
  }, []);

  const handleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    const el = videoRef.current;
    if (!container || !el) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    } else if ((el as any).webkitEnterFullscreen) {
      // iOS Safari fallback — opens native fullscreen player
      (el as any).webkitEnterFullscreen();
    }
  }, []);

  const controlsVisible = showControls || !playing;

  return (
    <div
      ref={containerRef}
      onMouseMove={playing ? resetHideTimer : undefined}
      onMouseLeave={() => {
        if (playing) {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          setShowControls(false);
        }
      }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: isFs ? 0 : 'var(--radius-md)',
        ...(isFs
          ? { background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }
          : placeholderSize
            ? { width: placeholderSize.width, maxWidth: '100%' }
            : {}
        ),
      }}
    >
      {/* Loading placeholder — shown until the first video frame is decoded */}
      {!ready && (
        <div
          onClick={handlePlaceholderClick}
          style={{
            ...(placeholderSize
              ? { width: placeholderSize.width, height: placeholderSize.height }
              : { width: '100%', aspectRatio: aspectRatio || '16 / 9' }
            ),
            maxWidth: '100%',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(var(--rgb-primary), 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div
            className="animate-spin"
            style={{
              width: '1.5rem',
              height: '1.5rem',
              border: '2.5px solid var(--color-border)',
              borderTopColor: 'var(--color-accent)',
              borderRadius: '50%',
            }}
          />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onLoadedData={handleLoadedData}
        onError={onError}
        onClick={togglePlay}
        style={{
          display: ready ? 'block' : 'none',
          cursor: 'pointer',
          ...(isFs
            ? { maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain' as const }
            : fillWidth
              ? { width: '100%', height: 'auto' }
              : { maxWidth: '100%', maxHeight: '400px' }
          ),
        }}
      >
        Your browser does not support video playback.
      </video>

      {/* Center play button overlay — shown when paused */}
      {ready && !playing && (
        <div
          onClick={togglePlay}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style={{ marginLeft: '2px' }}>
              <polygon points="6,3 20,12 6,21" />
            </svg>
          </div>
        </div>
      )}

      {/* Custom controls bar — play/pause, progress, mute, fullscreen */}
      {ready && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '1.25rem 0.5rem 0.375rem',
            background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
            opacity: controlsVisible ? 1 : 0,
            transition: 'opacity 0.2s',
            pointerEvents: controlsVisible ? 'auto' : 'none',
          }}
        >
          {/* Play / Pause */}
          <button onClick={togglePlay} style={videoControlBtnStyle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24">
                <rect x="5" y="3" width="4" height="18" rx="1" fill="white"/>
                <rect x="15" y="3" width="4" height="18" rx="1" fill="white"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24">
                <polygon points="6,3 20,12 6,21" fill="white"/>
              </svg>
            )}
          </button>

          {/* Progress bar — click to seek */}
          <div
            onClick={handleSeek}
            style={{
              flex: 1,
              height: '4px',
              background: 'rgba(255,255,255,0.3)',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            <div style={{
              height: '100%',
              width: `${currentProgress * 100}%`,
              background: 'var(--color-accent, #fff)',
              borderRadius: '2px',
              transition: 'width 0.1s linear',
            }} />
          </div>

          {/* Mute / Unmute */}
          <button onClick={toggleMute} style={videoControlBtnStyle} aria-label={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? (
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M11 5L6 9H2v6h4l5 4V5z" fill="white"/>
                <line x1="22" y1="9" x2="16" y2="15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <line x1="16" y1="9" x2="22" y2="15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M11 5L6 9H2v6h4l5 4V5z" fill="white"/>
                <path d="M15.54 8.46a5 5 0 010 7.07" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/>
              </svg>
            )}
          </button>

          {/* Fullscreen toggle */}
          <button onClick={handleFullscreen} style={videoControlBtnStyle} aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFs ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/** Thumbnail card for grid mode — shows the first frame of a video with a
 *  play-button overlay. Clicking opens the fullscreen media viewer. */
function VideoThumbnailCard({ src, aspectRatio, onClick, onError }: {
  src: string;
  aspectRatio?: string;
  onClick: () => void;
  onError: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Reset ready state when src changes
  useEffect(() => {
    setReady(false);
  }, [src]);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Play video"
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        aspectRatio: aspectRatio || '16 / 9',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: 'pointer',
        border: '2px solid transparent',
        borderColor: hovered ? 'var(--color-accent)' : 'transparent',
        padding: 0,
        background: 'rgba(var(--rgb-primary), 0.06)',
        transition: 'border-color 0.2s, transform 0.2s',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
      }}
    >
      {/* Loading spinner — shown until the video metadata/frame is available */}
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <div
            className="animate-spin"
            style={{
              width: '1.5rem',
              height: '1.5rem',
              border: '2.5px solid var(--color-border)',
              borderTopColor: 'var(--color-accent)',
              borderRadius: '50%',
            }}
          />
        </div>
      )}

      {/* Silent, paused video element to capture the first frame as a poster */}
      <video
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setReady(true)}
        onError={onError}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: ready ? 'block' : 'none',
          pointerEvents: 'none',
        }}
      />

      {/* Play button overlay — always shown so the card is tappable even while loading */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: hovered
            ? 'rgba(0, 0, 0, 0.25)'
            : ready ? 'rgba(0, 0, 0, 0.15)' : 'transparent',
          transition: 'background 0.2s',
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: '2.75rem',
            height: '2.75rem',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s',
            transform: hovered ? 'scale(1.1)' : 'scale(1)',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="white"
            style={{ marginLeft: '2px' }}
          >
            <polygon points="6,3 20,12 6,21" />
          </svg>
        </div>
      </div>
    </button>
  );
}

interface ChatVideoResultsProps {
  urls: string[];
  /** Gallery video IDs for persistent blob-based rendering (parallel to urls) */
  galleryVideoIds?: string[];
  /** Video aspect ratio as CSS string (e.g. "9 / 16") — prevents reflow when video loads */
  videoAspectRatio?: string;
  /** Whether videos should auto-play (default: true). Set false for restored history. */
  autoPlay?: boolean;
  /** Called when a different video starts playing (for menu sync) */
  onActiveIndexChange?: (index: number) => void;
  /** Called when a grid thumbnail is clicked — opens fullscreen viewer */
  onVideoClick?: (url: string, index: number) => void;
  /** Expected total slot count during progress — renders placeholders for pending slots */
  totalCount?: number;
  /** Per-job progress data for loading overlays on pending slots */
  perJobProgress?: Record<number, {
    progress?: number;
    etaSeconds?: number;
    resultUrl?: string;
    error?: string;
    label?: string;
    retryKey?: string;
  }>;
}

export const ChatVideoResults = memo(function ChatVideoResults({
  urls,
  galleryVideoIds,
  videoAspectRatio,
  autoPlay = true,
  onActiveIndexChange,
  onVideoClick,
  totalCount,
  perJobProgress,
}: ChatVideoResultsProps) {
  // Resolve gallery IDs to blob URLs — persistent local copies that never expire
  const galleryBlobUrls = useGalleryBlobUrls(galleryVideoIds);
  const [failedVideos, setFailedVideos] = useState<Set<number>>(new Set());
  // Number of slots: use totalCount during progress, otherwise urls.length
  const slotCount = Math.max(totalCount || 0, urls.length);
  const isGrid = slotCount > 1;

  const handleError = useCallback((index: number) => {
    setFailedVideos((prev) => new Set([...prev, index]));
  }, []);

  return (
    <div
      role="group"
      aria-label={`${slotCount} video result${slotCount !== 1 ? 's' : ''}`}
      style={isGrid ? {
        display: 'grid',
        gridTemplateColumns: `repeat(${slotCount <= 2 ? slotCount : 2}, minmax(0, 1fr))`,
        gap: '0.5rem',
        width: '100%',
      } : {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {Array.from({ length: slotCount }, (_, index) => {
        // During progress: per-job URL (keyed by slot index, always correct)
        // After progress: urls array (final truth)
        const perJobUrl = perJobProgress?.[index]?.resultUrl;
        const rawUrl = perJobUrl || urls[index] || '';
        const blobUrl = galleryBlobUrls.get(index);
        const displayUrl = blobUrl || rawUrl;
        const jobError = perJobProgress?.[index]?.error;
        const isFailed = failedVideos.has(index) || !!jobError;
        const isPending = !rawUrl && !isFailed;

        // Per-job progress info for pending slot overlays
        const jobData = perJobProgress?.[index];
        const jobProg = jobData?.progress;
        const jobPct = jobProg !== undefined ? Math.round(jobProg * 100) : 0;
        const jobETA = jobData?.etaSeconds;
        const jobProgressText = jobETA !== undefined && jobETA > 0
          ? formatETA(jobETA)
          : jobProg !== undefined
            ? `${jobPct}%`
            : null;

        return (
        <div
          key={index}
          style={{
            position: 'relative',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            ...(isGrid ? {} : { display: 'inline-block', maxWidth: '360px' }),
          }}
        >
          {isFailed ? (
            /* Failed / expired state — with retry button when retryKey is available */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                width: '100%',
                aspectRatio: videoAspectRatio || '16/9',
                background: 'rgba(var(--rgb-primary), 0.04)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M2 8h20" />
                <path d="M2 16h20" />
                <path d="M6 4v16" />
                <path d="M18 4v16" />
                <line x1="2" y1="4" x2="22" y2="20" />
              </svg>
              {jobData?.retryKey ? (
                <button
                  onClick={() => triggerRetry(jobData.retryKey!)}
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '0.25rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-accent)',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Retry clip
                </button>
              ) : (
                <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.7 }}>
                  Video expired
                </span>
              )}
            </div>
          ) : isPending ? (
            /* Loading placeholder for pending video slot */
            <div
              style={{
                width: '100%',
                aspectRatio: videoAspectRatio || '16 / 9',
                background: 'rgba(var(--rgb-primary), 0.06)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <div
                className="animate-spin"
                style={{
                  width: '1.5rem',
                  height: '1.5rem',
                  border: '2.5px solid var(--color-border)',
                  borderTopColor: 'var(--color-accent)',
                  borderRadius: '50%',
                }}
              />
              {jobData?.label && (
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                  {jobData.label}...
                </span>
              )}
              {jobProgressText && (
                <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)' }}>
                  {jobProgressText}
                </span>
              )}
              {jobProg !== undefined && (
                <div style={{
                  width: '60%',
                  height: '3px',
                  background: 'rgba(var(--rgb-primary), 0.1)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${jobPct}%`,
                    height: '100%',
                    background: 'var(--color-accent)',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}
            </div>
          ) : isGrid ? (
            /* Grid mode — thumbnail card with play overlay, click opens fullscreen viewer */
            <VideoThumbnailCard
              src={displayUrl}
              aspectRatio={videoAspectRatio}
              onClick={() => {
                onActiveIndexChange?.(index);
                onVideoClick?.(displayUrl, index);
              }}
              onError={() => handleError(index)}
            />
          ) : (
            /* Single video — full inline player */
            <ChatVideoPlayer
              src={displayUrl}
              onError={() => handleError(index)}
              onPlay={() => onActiveIndexChange?.(index)}
              aspectRatio={videoAspectRatio}
              fillWidth={false}
              autoPlay={autoPlay}
            />
          )}

          {/* Index badge (hidden for single results) */}
          {slotCount > 1 && (
            <div
              style={{
                position: 'absolute',
                top: '0.375rem',
                left: '0.375rem',
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '0.125rem 0.375rem',
                borderRadius: '0.25rem',
                lineHeight: '1.2',
                zIndex: 3,
                pointerEvents: 'none',
              }}
            >
              #{index + 1}
            </div>
          )}

        </div>
        );
      })}
    </div>
  );
});
