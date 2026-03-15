import React, { ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import { useModalCtx } from './context';
import { cdnAssets, videoMetadata } from '@/assets/cdn';

// Filter to landscape or square videos only (width >= height)
const WELCOME_VIDEOS = Object.entries(videoMetadata)
  .filter(([, meta]) => {
    const [w, h] = meta.resolution.split('x').map(Number);
    return w >= h;
  })
  .map(([key]) => cdnAssets.videos[key as keyof typeof cdnAssets.videos]);

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

interface Props {
  children: ReactNode;
}

export function ContentPanel({ children }: Props) {
  return <div className="p-6">{children}</div>;
}

interface FormPanelProps extends Props {
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  disabled?: boolean;
  autoComplete?: string;
  noValidate?: boolean;
}

export function FormPanel({ children, onSubmit, disabled, autoComplete, noValidate }: FormPanelProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="p-2"
      autoComplete={autoComplete}
      noValidate={noValidate}
    >
      <fieldset disabled={disabled} className="border-none p-0 m-0">
        {children}
      </fieldset>
    </form>
  );
}

interface FormContentProps extends Props {
  noHeading?: boolean;
  subHeading?: ReactNode;
}

export function FormContent({ children, noHeading, subHeading }: FormContentProps) {
  const { text } = useModalCtx();
  const [playlist] = useState(() => shuffleArray(WELCOME_VIDEOS));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isDimmed, setIsDimmed] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }, []);

  const handleVideoInteract = useCallback(() => {
    if (isDimmed) setIsDimmed(false);
  }, [isDimmed]);

  const handleEnded = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % playlist.length);
  }, [playlist.length]);

  // Sync muted state and ensure autoplay after source swap
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.play().catch(() => {});
    }
  }, [currentIndex, isMuted]);

  return (
    <div>
      {/* Header with SogniTV video background */}
      <div
        className="relative -mx-2 -mt-2 mb-6 rounded-t-lg overflow-hidden"
        style={{ aspectRatio: '16 / 9', cursor: isDimmed ? 'pointer' : undefined }}
        onClick={handleVideoInteract}
      >
        {/* Video player */}
        <video
          ref={videoRef}
          key={playlist[currentIndex]}
          src={playlist[currentIndex]}
          autoPlay
          muted
          playsInline
          onEnded={handleEnded}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* Dim overlay — fades out on interaction */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            opacity: isDimmed ? 1 : 0,
            transition: 'opacity 0.5s ease',
            pointerEvents: 'none',
          }}
        />
        {/* Mute/unmute toggle */}
        <button
          onClick={toggleMute}
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            zIndex: 2,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.4)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.6,
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
        {/* Gradient overlay for text readability */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 40%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />
        {/* Text overlay at bottom */}
        <div
          className="absolute bottom-0 left-0 right-0 text-center px-6 pb-5"
          style={{ zIndex: 1 }}
        >
          {!noHeading && (
            <h1
              className="text-xl font-bold mb-1"
              style={{
                color: '#fff',
                letterSpacing: '-0.02em',
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}
            >
              {text.heading}
            </h1>
          )}
          {subHeading && (
            <h2
              className="text-sm font-medium"
              style={{
                color: 'rgba(255,255,255,0.8)',
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              }}
            >
              {subHeading}
            </h2>
          )}
          {!noHeading && (
            <div
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(8px)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
              <span>50 Free Credits Daily</span>
            </div>
          )}
        </div>
      </div>
      <div className="px-2">
        {children}
      </div>
    </div>
  );
}

export function FieldContainer({ children }: Props) {
  return <div className="space-y-4">{children}</div>;
}

export function FormFooter({ children }: Props) {
  return <div className="mt-6 text-center px-2 pb-2">{children}</div>;
}

export function ErrorMessage({ children }: Props) {
  return (
    <div
      className="px-4 py-3 rounded-lg mb-4 text-sm"
      style={{
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        color: '#dc2626'
      }}
    >
      {children}
    </div>
  );
}

interface LinkButtonProps extends Props {
  onClick: () => void;
}

export function LinkButton({ children, onClick }: LinkButtonProps) {
  return (
    <button
      className="font-medium hover:underline transition-colors"
      style={{ color: 'var(--color-text-secondary)' }}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
