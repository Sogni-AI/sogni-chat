/**
 * Fullscreen media viewer overlay.
 * Shows a single media item (image, video, or audio) full-size
 * with navigation for paging through a batch of results.
 * Replaces the FullscreenBeforeAfter component.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { pauseAllVideos, setFullscreenOpen } from '@/components/chat/videoCoordination';

export interface MediaItem {
  type: 'image' | 'video' | 'audio';
  url: string;
  /** CSS aspect-ratio string for videos, e.g. "9 / 16" */
  aspectRatio?: string;
}

/** Mute toggle button shown over videos in the fullscreen viewer.
 *  Rendered inside a flex row alongside the close button — no absolute positioning needed. */
function MuteToggle({
  isMuted,
  onToggle,
}: {
  isMuted: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={isMuted ? 'Unmute video' : 'Mute video'}
      style={{
        background: 'rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '50%',
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'rgba(255, 255, 255, 0.8)',
        transition: 'background 150ms, color 150ms',
        padding: 0,
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
        e.currentTarget.style.color = '#ffffff';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)';
        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
      }}
    >
      {isMuted ? (
        /* Muted icon: speaker with X */
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        /* Unmuted icon: speaker with sound waves */
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
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
  const [isMuted, setIsMuted] = useState(false); // Videos play unmuted when explicitly opened for preview
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // Pause all inline chat videos when the fullscreen viewer opens,
  // and mark fullscreen as open so new videos don't auto-play behind it.
  useEffect(() => {
    pauseAllVideos();
    setFullscreenOpen(true);
    return () => {
      setFullscreenOpen(false);
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

  // Toggle mute on the video element and update state
  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = !el.muted;
      setIsMuted(el.muted);
    }
  }, []);

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
      if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, navigate, index, items.length, toggleMute]);

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
            zIndex: 3,
          }}
        >
          {index + 1} / {items.length}
        </div>
      )}

      {/* Top-right controls row: mute toggle + close button in a flex container
           so they never overlap regardless of video orientation */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 3,
        }}
      >
        {/* Mute toggle (only for videos) */}
        {item.type === 'video' && (
          <MuteToggle isMuted={isMuted} onToggle={toggleMute} />
        )}

        {/* Close button — sized to match mute button for visual consistency */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '50%',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.8)',
            transition: 'background 150ms, color 150ms',
            padding: 0,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

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
            ref={videoRef}
            key={item.url}
            src={item.url}
            autoPlay
            loop
            controls
            playsInline
            muted={isMuted}
            style={{
              maxHeight: '85vh',
              maxWidth: '90vw',
              objectFit: 'contain',
              borderRadius: 'var(--radius-lg, 0.75rem)',
              display: 'block',
              // Note: aspectRatio is intentionally NOT set on the video element.
              // Setting it creates a CSS box that can differ from the video's
              // intrinsic dimensions, causing the browser to render a second
              // set of native controls in the empty gap (especially visible
              // with portrait 9:16 videos). The video's own intrinsic ratio
              // combined with objectFit:contain handles sizing correctly.
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
