/**
 * Inline image results displayed within chat messages.
 * Shows a grid of restored/styled images with click-to-expand.
 * When sourceImageUrl is provided, shows it as a blurred placeholder
 * and fades the result image in on top once loaded.
 * Prefers gallery blob URLs (persistent) over remote URLs (may expire).
 * Shows an "expired" state if the image fails to load.
 */
import { memo, useState } from 'react';
import { useGalleryBlobUrls } from '@/hooks/useGalleryBlobUrls';

interface ChatImageResultsProps {
  urls: string[];
  /** Source image URL — shown blurred as placeholder while result loads */
  sourceImageUrl?: string;
  onImageClick?: (url: string, index: number) => void;
  /** Gallery image IDs for persistent blob-based rendering (parallel to urls) */
  galleryImageIds?: string[];
}

export const ChatImageResults = memo(function ChatImageResults({
  urls,
  sourceImageUrl,
  onImageClick,
  galleryImageIds,
}: ChatImageResultsProps) {
  // Resolve gallery IDs to blob URLs — persistent local copies that never expire
  const galleryBlobUrls = useGalleryBlobUrls(galleryImageIds);
  const isSingle = urls.length === 1;
  const columns = urls.length <= 2 ? urls.length : 2;

  // Track which result images have finished loading
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  // Track which result images failed to load (expired URLs)
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  const handleLoad = (index: number) => {
    setLoadedImages((prev) => new Set([...prev, index]));
  };

  const handleError = (index: number) => {
    setFailedImages((prev) => new Set([...prev, index]));
  };

  return (
    <div
      role="group"
      aria-label={`${urls.length} result${urls.length !== 1 ? 's' : ''}`}
      style={{
        display: 'inline-grid',
        gridTemplateColumns: isSingle
          ? 'minmax(0, 360px)'
          : `repeat(${columns}, minmax(0, 1fr))`,
        gap: '0.5rem',
        maxWidth: isSingle ? '360px' : '100%',
      }}
    >
      {urls.map((url, index) => {
        const isLoaded = loadedImages.has(index);
        const isFailed = failedImages.has(index);
        // Prefer gallery blob URL (persistent) over remote URL (may expire)
        const displayUrl = galleryBlobUrls.get(index) || url;

        return (
          <button
            key={`${url}-${index}`}
            onClick={() => !isFailed && onImageClick?.(displayUrl, index)}
            style={{
              position: 'relative',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              cursor: isFailed ? 'default' : 'pointer',
              border: '2px solid transparent',
              padding: 0,
              background: 'rgba(var(--rgb-primary), 0.05)',
              transition: 'border-color 0.2s, transform 0.2s',
              aspectRatio: isFailed && !sourceImageUrl ? '4/3' : undefined,
            }}
            onMouseEnter={(e) => {
              if (!isFailed) {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.transform = 'scale(1.02)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'transparent';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title={isFailed ? 'Image no longer available' : urls.length > 1 ? `Result #${index + 1} — click to view` : 'Click to view'}
          >
            {/* Blurred source placeholder — in flow until result loads, then hidden */}
            {sourceImageUrl && !isLoaded && (
              <img
                src={sourceImageUrl}
                alt=""
                aria-hidden="true"
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  filter: 'blur(12px)',
                  transform: 'scale(1.05)',
                  pointerEvents: 'none',
                  ...(isFailed ? { opacity: 0.3 } : {}),
                }}
              />
            )}

            {/* Expired / error overlay */}
            {isFailed && (
              <div
                style={{
                  position: sourceImageUrl ? 'absolute' : 'relative',
                  inset: sourceImageUrl ? 0 : undefined,
                  width: '100%',
                  height: sourceImageUrl ? undefined : '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.375rem',
                  zIndex: 2,
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {/* Broken image icon */}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="3" x2="21" y2="21" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.7 }}>
                  Image expired
                </span>
              </div>
            )}

            {/* Spinner placeholder when no source image */}
            {!sourceImageUrl && !isLoaded && !isFailed && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(var(--rgb-primary), 0.05)',
                }}
              >
                <div
                  className="animate-spin"
                  style={{
                    width: '1.5rem',
                    height: '1.5rem',
                    border: '2px solid var(--color-border)',
                    borderTopColor: 'var(--color-accent)',
                    borderRadius: '50%',
                  }}
                />
              </div>
            )}

            {/* Result image — overlays placeholder while loading, then becomes in-flow */}
            {!isFailed && (
              <img
                src={displayUrl}
                alt={urls.length > 1 ? `Result #${index + 1}` : 'Result'}
                onLoad={() => handleLoad(index)}
                onError={() => handleError(index)}
                style={{
                  ...(sourceImageUrl && !isLoaded
                    ? {
                        position: 'absolute' as const,
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }
                    : {
                        width: '100%',
                        height: 'auto',
                        display: 'block',
                      }),
                  opacity: isLoaded ? 1 : 0,
                  transition: 'opacity 1.5s ease-in-out',
                  zIndex: 1,
                }}
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
                  zIndex: 2,
                }}
              >
                #{index + 1}
              </div>
            )}

          </button>
        );
      })}
    </div>
  );
});
