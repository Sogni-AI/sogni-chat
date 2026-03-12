import { useState, useRef, useCallback, useEffect } from 'react';
import { sogniTVController } from '@/services/sogniTVController';
import { buildPlaylist, markFirstPlayDone } from './SogniTV';

export function SogniTVPreview() {
  const [dismissed, setDismissed] = useState(false);
  const [playlist] = useState(() => buildPlaylist());
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Mark first-time playlist as seen (in effect, not during render, for StrictMode safety)
  useEffect(() => { markFirstPlayDone(); }, []);

  // Dismiss when SogniTV opens from any source (e.g. the purple icon)
  useEffect(() => {
    return sogniTVController.subscribe(() => {
      if (sogniTVController.getState().isOpen) setDismissed(true);
    });
  }, []);

  // Always-fresh current URL for the click handler
  const currentUrlRef = useRef(playlist[0]);
  currentUrlRef.current = playlist[currentIndex];

  const handleEnded = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % playlist.length);
  }, [playlist.length]);

  const handleOpen = useCallback(() => {
    sogniTVController.open(false, currentUrlRef.current);
    setDismissed(true);
  }, []);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
  }, []);

  if (dismissed) return null;

  return (
    <>
      <style>{`
        @keyframes sogniTvPreviewIn {
          from { opacity: 0; transform: translateY(16px) scale(0.92); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sogniTvPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 99998,
          width: 288,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#111',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          cursor: 'pointer',
          animation: 'sogniTvPreviewIn 0.5s ease-out',
          transition: 'transform 0.2s, box-shadow 0.2s',
          transform: isHovered ? 'scale(1.02)' : 'scale(1)',
        }}
        onClick={handleOpen}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Label bar */}
        <div style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), rgba(0,0,0,0.5))',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#ff4444',
              flexShrink: 0,
              animation: 'sogniTvPulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.9)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: 'Inter, sans-serif',
              letterSpacing: '0.02em',
            }}>
              What&apos;s Hot: Creating LTX-2.3 Cinema
            </span>
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              width: 20,
              height: 20,
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.6rem',
              flexShrink: 0,
              padding: 0,
              lineHeight: 1,
              transition: 'color 0.2s, background 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget).style.background = 'rgba(255,255,255,0.25)';
              (e.currentTarget).style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget).style.background = 'rgba(255,255,255,0.1)';
              (e.currentTarget).style.color = 'rgba(255,255,255,0.6)';
            }}
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        {/* Video */}
        <div style={{ position: 'relative', aspectRatio: '1/1', background: '#000' }}>
          <video
            ref={videoRef}
            key={playlist[currentIndex]}
            src={playlist[currentIndex]}
            autoPlay
            muted
            playsInline
            onEnded={handleEnded}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          {/* Muted icon — hints that clicking opens unmuted full player */}
          <div style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          </div>
        </div>
      </div>
    </>
  );
}
