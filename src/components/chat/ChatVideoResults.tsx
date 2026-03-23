/**
 * Inline video results displayed within chat messages.
 *
 * Single video: full inline player with controls, auto-play, and pause coordination.
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
import { activeVideos, pauseOtherVideos, isFullscreenOpen, markAutoPlay, consumeAutoPlay } from './videoCoordination';

/** Individual video player that pauses all other chat videos when it starts playing.
 *  Shows a poster-frame overlay until the video is ready, then reveals the
 *  native player. The overlay is always clickable so users can force-play
 *  even if the ready signal hasn't fired yet. */
function ChatVideoPlayer({ src, onError, onPlay, aspectRatio, fillWidth, autoPlay = true }: { src: string; onError: () => void; onPlay?: () => void; aspectRatio?: string; fillWidth?: boolean; autoPlay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const [ready, setReady] = useState(false);

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
      }
      pauseOtherVideos(el);
      if (el.muted) el.muted = false;
      onPlayRef.current?.();
    };
    el.addEventListener('play', handlePlay);

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
      activeVideos.delete(el);
      observer.disconnect();
    };
  }, []);

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
    el.play().catch(() => { /* browser may block — that's fine, controls are visible */ });
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      {/* Video always in DOM — display:none prevents loading on iOS Safari,
          causing onLoadedData to never fire and the spinner to stay forever.
          We use opacity:0 so the element stays in the render tree and the
          browser fetches video data even before the first frame is decoded. */}
      <video
        ref={videoRef}
        src={src}
        controls
        controlsList="nodownload"
        loop
        playsInline
        preload="auto"
        onLoadedData={handleLoadedData}
        onError={onError}
        style={{
          borderRadius: 'var(--radius-md)',
          opacity: ready ? 1 : 0,
          ...(ready
            ? (fillWidth
                ? { width: '100%', height: 'auto' }
                : { maxWidth: '100%', maxHeight: '400px' })
            : (fillWidth || !placeholderSize
                ? { width: '100%', aspectRatio: aspectRatio || '16 / 9' }
                : { width: placeholderSize.width, height: placeholderSize.height, maxWidth: '100%' })
          ),
        }}
      >
        Your browser does not support video playback.
      </video>
      {/* Loading overlay — covers the video until the first frame is decoded.
          Clicking forces the video to show with native controls. */}
      {!ready && (
        <div
          onClick={handlePlaceholderClick}
          style={{
            position: 'absolute',
            inset: 0,
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
          // display:none prevents loading on iOS Safari — use opacity instead
          opacity: ready ? 1 : 0,
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
}

export const ChatVideoResults = memo(function ChatVideoResults({
  urls,
  galleryVideoIds,
  videoAspectRatio,
  autoPlay = true,
  onActiveIndexChange,
  onVideoClick,
}: ChatVideoResultsProps) {
  // Resolve gallery IDs to blob URLs — persistent local copies that never expire
  const galleryBlobUrls = useGalleryBlobUrls(galleryVideoIds);
  const [failedVideos, setFailedVideos] = useState<Set<number>>(new Set());
  const isGrid = urls.length > 1;

  const handleError = useCallback((index: number) => {
    setFailedVideos((prev) => new Set([...prev, index]));
  }, []);

  return (
    <div
      role="group"
      aria-label={`${urls.length} video result${urls.length !== 1 ? 's' : ''}`}
      style={isGrid ? {
        display: 'grid',
        gridTemplateColumns: `repeat(${urls.length <= 2 ? urls.length : 2}, minmax(0, 1fr))`,
        gap: '0.5rem',
        width: '100%',
      } : {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {urls.map((url, index) => {
        // Prefer gallery blob URL (persistent) over remote URL (may expire)
        const blobUrl = galleryBlobUrls.get(index);
        const displayUrl = blobUrl || url;
        const isFailed = failedVideos.has(index);

        return (
        <div
          key={`${url}-${index}`}
          style={{
            position: 'relative',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            ...(isGrid ? {} : { display: 'inline-block', maxWidth: '360px' }),
          }}
        >
          {isFailed ? (
            /* Expired / error state */
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
              {/* Film/video icon with X */}
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M2 8h20" />
                <path d="M2 16h20" />
                <path d="M6 4v16" />
                <path d="M18 4v16" />
                <line x1="2" y1="4" x2="22" y2="20" />
              </svg>
              <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.7 }}>
                Video expired
              </span>
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
          {urls.length > 1 && (
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
