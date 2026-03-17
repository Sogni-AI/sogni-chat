/**
 * Inline video results displayed within chat messages.
 * Shows video players with a save/download button overlay.
 * Prefers gallery blob URLs (persistent) over remote URLs (may expire).
 * Shows an "expired" state if the video fails to load.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGalleryBlobUrls } from '@/hooks/useGalleryBlobUrls';
import { activeVideos, pauseOtherVideos } from './videoCoordination';
import { isMobile } from '@/utils/mobileDownload';

/** Individual video player that pauses all other chat videos when it starts playing.
 *  Hides the native player until the first frame is ready to prevent the
 *  ugly black unstyled rectangle that flashes while the video is loading. */
function ChatVideoPlayer({ src, onError, aspectRatio, fillWidth, autoPlay = true, isLocalBlob = false }: { src: string; onError: () => void; aspectRatio?: string; fillWidth?: boolean; autoPlay?: boolean; isLocalBlob?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
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

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    activeVideos.add(el);

    const handlePlay = () => {
      pauseOtherVideos(el);
      if (el.muted) el.muted = false;
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

  return (
    <div style={{ position: 'relative' }}>
      {/* Loading placeholder — shown until the first video frame is decoded */}
      {!ready && (
        <div
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
        autoPlay={autoPlay}
        controls
        loop
        playsInline={!isMobile()}
        preload={(autoPlay || isLocalBlob) ? 'auto' : 'metadata'}
        onLoadedMetadata={() => { if (!autoPlay) setReady(true); }}
        onLoadedData={() => setReady(true)}
        onError={onError}
        style={{
          display: ready ? 'block' : 'none',
          borderRadius: 'var(--radius-md)',
          ...(fillWidth
            ? { width: '100%', height: 'auto' }
            : { maxWidth: '100%', maxHeight: '400px' }
          ),
        }}
      >
        Your browser does not support video playback.
      </video>
    </div>
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
}

export const ChatVideoResults = memo(function ChatVideoResults({
  urls,
  galleryVideoIds,
  videoAspectRatio,
  autoPlay = true,
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
        display: 'inline-grid',
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
          ) : (
            /* Video player */
            <ChatVideoPlayer
              src={displayUrl}
              onError={() => handleError(index)}
              aspectRatio={videoAspectRatio}
              fillWidth={isGrid}
              autoPlay={autoPlay}
              isLocalBlob={!!blobUrl}
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
