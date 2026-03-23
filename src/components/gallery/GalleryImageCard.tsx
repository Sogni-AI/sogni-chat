/**
 * GalleryImageCard - An individual result image card with favorite toggle
 * and download button. Manages blob URL lifecycle for display.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { GalleryImage } from '@/types/gallery';
import { downloadBlob } from '@/utils/download';
import { buildDownloadFilename } from '@/utils/downloadFilename';
import { useLazyLoad } from '@/hooks/useLazyLoad';

const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

// ============================================================================
// Types
// ============================================================================

interface GalleryImageCardProps {
  image: GalleryImage;
  onToggleFavorite: (imageId: string) => Promise<boolean>;
  onDownload?: (blob: Blob, filename: string) => void;
  onClick?: (image: GalleryImage) => void;
  index?: number;
}

// ============================================================================
// Component
// ============================================================================

const GalleryImageCard: React.FC<GalleryImageCardProps> = ({
  image,
  onToggleFavorite,
  onDownload,
  onClick,
  index = 0,
}) => {
  const [isFavorite, setIsFavorite] = useState(image.isFavorite);
  const [isHovered, setIsHovered] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const blobUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { ref: lazyRef, isVisible } = useLazyLoad({ rootMargin: '300px' });

  useEffect(() => {
    if (!isVisible) return;
    const url = URL.createObjectURL(image.blob);
    blobUrlRef.current = url;
    setImageUrl(url);

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [image.blob, isVisible]);

  useEffect(() => {
    setIsFavorite(image.isFavorite);
  }, [image.isFavorite]);

  const handleFavoriteClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newValue = !isFavorite;
    setIsFavorite(newValue);

    try {
      const result = await onToggleFavorite(image.id);
      setIsFavorite(result);
    } catch {
      setIsFavorite(!newValue);
    }
  }, [isFavorite, onToggleFavorite, image.id]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const type = image.mediaType === 'video' ? 'video' as const
      : image.mediaType === 'audio' ? 'audio' as const
      : 'restored' as const;
    const filename = buildDownloadFilename(undefined, image.index + 1, type);
    const downloadFn = onDownload || ((blob: Blob, fn: string) => downloadBlob(blob, fn));
    downloadFn(image.blob, filename);
  }, [image, onDownload]);

  const handleClick = useCallback(() => {
    onClick?.(image);
  }, [onClick, image]);

  const handleToggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }, []);

  return (
    <div
      ref={lazyRef}
      onClick={handleClick}
      onMouseEnter={() => {
        setIsHovered(true);
        if (image.mediaType === 'video' && videoRef.current) {
          videoRef.current.play().catch(() => {});
          if (supportsHover) {
            videoRef.current.muted = false;
            setIsMuted(false);
          }
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (image.mediaType === 'video' && videoRef.current) {
          videoRef.current.pause();
          videoRef.current.muted = true;
          setIsMuted(true);
        }
      }}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 'var(--radius-md)',
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: isHovered ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        transition: 'all 0.2s ease',
        animationDelay: `${Math.min(index * 50, 500)}ms`,
        animationFillMode: 'both',
      }}
    >
      {/* Media content */}
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'var(--color-bg)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {!isVisible || !imageUrl ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--color-bg-elevated)',
            }}
          />
        ) : image.mediaType === 'audio' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              padding: '16px',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <audio
              src={imageUrl}
              controls
              style={{ width: '90%', maxWidth: '200px', height: '32px' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : image.mediaType === 'video' ? (
          <video
            ref={videoRef}
            src={imageUrl}
            muted
            loop
            playsInline
            preload="auto"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <img
            src={imageUrl}
            alt={`Result ${image.index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        )}

        {/* Video badge + mute toggle */}
        {image.mediaType === 'video' && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                color: 'white',
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-primary)',
                letterSpacing: '0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Video
            </div>
            <button
              onClick={handleToggleMute}
              aria-label={isMuted ? 'Unmute video' : 'Mute video'}
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                width: '26px',
                height: '22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'white',
                padding: 0,
              }}
            >
              {isMuted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Heart button (always visible) */}
      <button
        onClick={handleFavoriteClick}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)',
          border: 'none',
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          zIndex: 2,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: isFavorite ? '#ef4444' : 'rgba(255, 255, 255, 0.85)',
          }}
        >
          <path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            fill={isFavorite ? 'currentColor' : 'none'}
          />
        </svg>
      </button>

      {/* Download button (appears on hover) */}
      <button
        onClick={handleDownload}
        aria-label="Download"
        style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)',
          border: 'none',
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          opacity: isHovered ? 1 : 0,
          zIndex: 2,
          color: 'rgba(255, 255, 255, 0.85)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>
  );
};

export default React.memo(GalleryImageCard);
