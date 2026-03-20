/**
 * Fullscreen media viewer overlay.
 * Shows a single media item (image, video, or audio) full-size
 * with navigation for paging through a batch of results.
 * Replaces the FullscreenBeforeAfter component.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';

export interface MediaItem {
  type: 'image' | 'video' | 'audio';
  url: string;
  /** CSS aspect-ratio string for videos, e.g. "9 / 16" */
  aspectRatio?: string;
}

interface FullscreenMediaViewerProps {
  items: MediaItem[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

/** Maximum number of dot indicators to show */
const MAX_DOTS = 20;

export const FullscreenMediaViewer = memo(function FullscreenMediaViewer({
  items,
  currentIndex,
  onClose,
  onNavigate,
}: FullscreenMediaViewerProps) {
  const [index, setIndex] = useState(currentIndex);
  const [visible, setVisible] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external index changes
  useEffect(() => setIndex(currentIndex), [currentIndex]);

  // Fade-in on mount
  useEffect(() => {
    // requestAnimationFrame ensures the initial opacity:0 is painted first
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const navigate = useCallback(
    (newIndex: number) => {
      setIndex(newIndex);
      onNavigate(newIndex);
    },
    [onNavigate],
  );

  const goPrev = useCallback(() => {
    if (index > 0) navigate(index - 1);
  }, [index, navigate]);

  const goNext = useCallback(() => {
    if (index < items.length - 1) navigate(index + 1);
  }, [index, items.length, navigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (index > 0) navigate(index - 1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (index < items.length - 1) navigate(index + 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, navigate, index, items.length]);

  // Touch/swipe gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return;
      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      touchStartX.current = null;
      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0 && index > 0) {
          navigate(index - 1);
        } else if (deltaX < 0 && index < items.length - 1) {
          navigate(index + 1);
        }
      }
    },
    [index, items.length, navigate],
  );

  // Backdrop click (only fires when clicking the overlay itself)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Stop clicks on media from propagating to backdrop
  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const item = items[index];
  if (!item) return null;

  const showNav = items.length > 1;
  const showDots = showNav && items.length <= MAX_DOTS;

  return (
    <div
      ref={containerRef}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.9)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms ease-out',
      }}
    >
      {/* Counter (top-left) */}
      {showNav && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: 14,
            fontFamily: 'var(--font-primary)',
            textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
            userSelect: 'none',
          }}
        >
          {index + 1} / {items.length}
        </div>
      )}

      {/* Close button (top-right) */}
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'none',
          border: 'none',
          color: 'rgba(255, 255, 255, 0.8)',
          fontSize: '1.75rem',
          lineHeight: 1,
          cursor: 'pointer',
          padding: 8,
          zIndex: 2,
          transition: 'color 150ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#ffffff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
        }}
      >
        &times;
      </button>

      {/* Media content */}
      <div onClick={stopPropagation} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {item.type === 'image' && (
          <img
            key={item.url}
            src={item.url}
            alt={`Result ${index + 1}`}
            draggable={false}
            style={{
              maxHeight: '85vh',
              maxWidth: '90vw',
              objectFit: 'contain',
              borderRadius: 'var(--radius-lg, 0.75rem)',
              display: 'block',
            }}
          />
        )}

        {item.type === 'video' && (
          <video
            key={item.url}
            src={item.url}
            autoPlay
            loop
            controls
            playsInline
            muted
            style={{
              maxHeight: '85vh',
              maxWidth: '90vw',
              objectFit: 'contain',
              borderRadius: 'var(--radius-lg, 0.75rem)',
              display: 'block',
              ...(item.aspectRatio ? { aspectRatio: item.aspectRatio } : {}),
            }}
          />
        )}

        {item.type === 'audio' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              padding: '40px 48px',
              background: 'rgba(255, 255, 255, 0.06)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: 'var(--radius-lg, 0.75rem)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: 'var(--shadow-xl, 0 16px 48px rgba(0, 0, 0, 0.5))',
            }}
          >
            {/* Speaker / music icon */}
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255, 255, 255, 0.6)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <audio
              key={item.url}
              src={item.url}
              controls
              style={{ minWidth: 280 }}
            />
          </div>
        )}
      </div>

      {/* Left arrow button (desktop only) */}
      {showNav && index > 0 && (
        <button
          onClick={goPrev}
          aria-label="Previous"
          className="fullscreen-viewer-nav-arrow"
          style={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 150ms',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Right arrow button (desktop only) */}
      {showNav && index < items.length - 1 && (
        <button
          onClick={goNext}
          aria-label="Next"
          className="fullscreen-viewer-nav-arrow"
          style={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 150ms',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Dot indicators (bottom center) */}
      {showDots && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 8,
            zIndex: 2,
          }}
        >
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => navigate(i)}
              aria-label={`Go to item ${i + 1}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background: i === index ? '#ffffff' : 'rgba(255, 255, 255, 0.4)',
                transition: 'background 150ms',
              }}
            />
          ))}
        </div>
      )}

      {/* Hide arrow nav buttons on mobile via injected style tag */}
      <style>{`
        @media (max-width: 768px) {
          .fullscreen-viewer-nav-arrow {
            display: none !important;
          }
        }
        @media (pointer: coarse) {
          .fullscreen-viewer-nav-arrow {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
});
