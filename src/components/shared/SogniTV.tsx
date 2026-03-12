import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cdnAssets } from '@/assets/cdn';
import { sogniTVController } from '@/services/sogniTVController';
import type { TVProgress } from '@/services/sogniTVController';

const FIRST_TIME_KEY = 'sogni-tv-first-play-done';
const SESSION_PLAYLIST_KEY = 'sogni-tv-session-playlist';
const STATIC_MIN_MS = 2000;
const STATIC_MAX_MS = 4000;

function randomStaticDuration() {
  return STATIC_MIN_MS + Math.random() * (STATIC_MAX_MS - STATIC_MIN_MS);
}

const ALL_VIDEOS = Object.values(cdnAssets.videos);
const VIDEO_NAMES = Object.keys(cdnAssets.videos) as (keyof typeof cdnAssets.videos)[];

// First-time ordering: these play first, in order
const FIRST_TIME_ORDER: (keyof typeof cdnAssets.videos)[] = [
  'samuelJacksonPulpFiction',
  'alien',
  'shining',
  'shiningShellyDuvall',
];

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function buildPlaylist(): string[] {
  const isFirstTime = !localStorage.getItem(FIRST_TIME_KEY);

  const cached = sessionStorage.getItem(SESSION_PLAYLIST_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Don't reuse a stale first-time playlist after the flag has been set
      if (!isFirstTime && parsed[0] === cdnAssets.videos[FIRST_TIME_ORDER[0]]) {
        sessionStorage.removeItem(SESSION_PLAYLIST_KEY);
      } else {
        return parsed;
      }
    } catch {
      // fall through to rebuild
    }
  }

  let playlist: string[];

  if (isFirstTime) {
    const priorityUrls = FIRST_TIME_ORDER.map((key) => cdnAssets.videos[key]);
    const remaining = ALL_VIDEOS.filter((url) => !priorityUrls.includes(url));
    playlist = [...priorityUrls, ...shuffleArray(remaining)];
    localStorage.setItem(FIRST_TIME_KEY, 'true');
  } else {
    playlist = shuffleArray(ALL_VIDEOS);
  }

  sessionStorage.setItem(SESSION_PLAYLIST_KEY, JSON.stringify(playlist));
  return playlist;
}

function getVideoLabel(url: string): string {
  const entry = VIDEO_NAMES.find((key) => cdnAssets.videos[key] === url);
  if (!entry) return '';
  return entry
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)/g, ' $1')
    .trim()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --- TV Static Effect (canvas noise + white noise audio) ---

function useStaticEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const startStatic = useCallback(() => {
    // --- Visual noise ---
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Use a smaller internal resolution for chunky CRT-style noise
        canvas.width = 192;
        canvas.height = 108;
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;

        const drawNoise = () => {
          for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 255;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
          }
          ctx.putImageData(imageData, 0, 0);
          animFrameRef.current = requestAnimationFrame(drawNoise);
        };
        drawNoise();
      }
    }

    // --- Audio white noise ---
    try {
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const bufferSize = audioCtx.sampleRate * 1; // 1 second buffer
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        channel[i] = Math.random() * 2 - 1;
      }
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = audioCtx.createGain();
      gain.gain.value = 0.08; // subtle
      source.connect(gain);
      gain.connect(audioCtx.destination);
      source.start();

      noiseNodeRef.current = source;
      gainNodeRef.current = gain;
    } catch {
      // Audio not available — visual static is enough
    }
  }, []);

  const stopStatic = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);

    // Fade out audio quickly
    if (gainNodeRef.current && audioCtxRef.current) {
      try {
        gainNodeRef.current.gain.linearRampToValueAtTime(
          0,
          audioCtxRef.current.currentTime + 0.05,
        );
      } catch { /* ignore */ }
    }
    setTimeout(() => {
      try { noiseNodeRef.current?.stop(); } catch { /* ignore */ }
      try { audioCtxRef.current?.close(); } catch { /* ignore */ }
      noiseNodeRef.current = null;
      audioCtxRef.current = null;
      gainNodeRef.current = null;
    }, 60);
  }, []);

  return { canvasRef, startStatic, stopStatic };
}

// --- Floating Icon ---

function TVIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="13" rx="2" />
      <polyline points="8 3 12 7 16 3" />
      <line x1="7" y1="17" x2="7" y2="17.01" />
    </svg>
  );
}

// --- Render Progress Overlay (bottom-right countdown / percentage) ---

function useRenderProgress(): TVProgress | null {
  const [progress, setProgress] = useState<TVProgress | null>(
    () => sogniTVController.getState().progress,
  );

  useEffect(() => {
    return sogniTVController.subscribe(() => {
      setProgress(sogniTVController.getState().progress);
    });
  }, []);

  return progress;
}

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
  return `${s}s`;
}

function RenderProgressOverlay() {
  const progress = useRenderProgress();
  if (!progress) return null;

  const pct = Math.round(Math.min(1, Math.max(0, progress.progress)) * 100);
  const hasEta = progress.etaSeconds != null && progress.etaSeconds > 0;
  const almostDone = pct >= 90;

  return (
    <div style={{
      position: 'absolute',
      bottom: 56,
      right: 20,
      zIndex: 40,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 4,
      animation: 'sogniTvProgressIn 0.4s ease-out',
      pointerEvents: 'none',
    }}>
      <style>{`
        @keyframes sogniTvProgressIn {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sogniTvProgressPulse {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Main pill */}
      <div style={{
        background: almostDone
          ? 'rgba(34, 197, 94, 0.2)'
          : 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(12px)',
        border: almostDone
          ? '1px solid rgba(34, 197, 94, 0.4)'
          : '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 12,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        animation: almostDone ? 'sogniTvProgressPulse 1.5s ease-in-out infinite' : undefined,
      }}>
        {/* Circular progress ring */}
        <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
          <circle
            cx="14" cy="14" r="11"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="2.5"
          />
          <circle
            cx="14" cy="14" r="11"
            fill="none"
            stroke={almostDone ? '#22c55e' : '#a78bfa'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 11}`}
            strokeDashoffset={`${2 * Math.PI * 11 * (1 - pct / 100)}`}
            transform="rotate(-90 14 14)"
            style={{ transition: 'stroke-dashoffset 0.6s ease-out, stroke 0.3s' }}
          />
          <text
            x="14" y="15"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#fff"
            fontSize="8"
            fontWeight="700"
            fontFamily="Inter, sans-serif"
          >
            {pct}%
          </text>
        </svg>

        {/* Text */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: '#fff',
            lineHeight: 1.2,
            fontFamily: 'Inter, sans-serif',
          }}>
            {hasEta
              ? formatEta(progress.etaSeconds!)
              : `${pct}%`
            }
          </span>
          <span style={{
            fontSize: '0.6875rem',
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.2,
            fontFamily: 'Inter, sans-serif',
          }}>
            {almostDone
              ? 'Almost ready!'
              : 'Your render is in progress'
            }
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Fullscreen Player ---

function SogniTVPlayer({ onClose }: { onClose: () => void }) {
  const [playlist] = useState<string[]>(() => buildPlaylist());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showStatic, setShowStatic] = useState(false);
  const pendingIndexRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { canvasRef, startStatic, stopStatic } = useStaticEffect();

  const currentUrl = playlist[currentIndex];
  const nextIndex = (currentIndex + 1) % playlist.length;
  const label = getVideoLabel(currentUrl);

  const staticDurationRef = useRef(0);

  // Transition with static effect
  const transitionTo = useCallback((targetIndex: number) => {
    if (showStatic) return; // already transitioning
    // Stop the current video so its audio doesn't bleed through the static
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    pendingIndexRef.current = targetIndex;
    const duration = randomStaticDuration();
    staticDurationRef.current = duration;
    setShowStatic(true);
    startStatic();

    setTimeout(() => {
      setCurrentIndex(targetIndex);
      pendingIndexRef.current = null;
      stopStatic();
      setShowStatic(false);
    }, duration);
  }, [showStatic, startStatic, stopStatic]);

  const goNext = useCallback(() => {
    transitionTo((currentIndex + 1) % playlist.length);
  }, [currentIndex, playlist.length, transitionTo]);

  const goPrev = useCallback(() => {
    transitionTo((currentIndex - 1 + playlist.length) % playlist.length);
  }, [currentIndex, playlist.length, transitionTo]);

  // Keyboard controls
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) v.paused ? v.play() : v.pause();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Preload next video
  useEffect(() => {
    const el = preloadRef.current;
    if (el) {
      el.src = playlist[nextIndex];
      el.load();
    }
  }, [nextIndex, playlist]);

  // Cleanup static on unmount
  useEffect(() => {
    return () => stopStatic();
  }, [stopStatic]);

  return createPortal(
    <div
      ref={containerRef}
      onClick={(e) => { if (e.target === containerRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200000,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'sogniTvFadeIn 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes sogniTvFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes sogniTvPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes sogniTvScanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(200vh); }
        }
        .sogni-tv-nav:hover {
          background: rgba(255,255,255,0.15) !important;
        }
        .sogni-tv-close:hover {
          background: rgba(255,255,255,0.15) !important;
        }
      `}</style>

      {/* TV Static overlay */}
      {showStatic && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
            }}
          />
          {/* CRT scanline overlay — lighter bands */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 4px)',
            pointerEvents: 'none',
          }} />
          {/* Moving scanline bar — sweeps continuously */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '12%',
            background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.08), transparent)',
            animation: 'sogniTvScanline 1.2s linear infinite',
            pointerEvents: 'none',
          }} />
          {/* Secondary band — different speed for variety */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '6%',
            background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.2), transparent)',
            animation: 'sogniTvScanline 0.8s linear infinite',
            animationDelay: '0.4s',
            pointerEvents: 'none',
          }} />
          {/* Third thin band — fastest */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3%',
            background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.05), transparent)',
            animation: 'sogniTvScanline 0.6s linear infinite',
            animationDelay: '0.2s',
            pointerEvents: 'none',
          }} />
        </div>
      )}

      {/* Header bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        zIndex: 30,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TVIcon size={20} />
          <span style={{
            fontFamily: 'Lora, serif',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: '#fff',
            letterSpacing: '0.5px',
          }}>
            SogniTV
          </span>
          <span style={{
            fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.4)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginLeft: 4,
          }}>
            LIVE
          </span>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#ff4444',
            animation: 'sogniTvPulse 2s ease-in-out infinite',
          }} />
        </div>

        <button
          className="sogni-tv-close"
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: '#fff',
            width: 36,
            height: 36,
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            transition: 'background 0.2s',
          }}
          aria-label="Close SogiTV"
        >
          ✕
        </button>
      </div>

      {/* Video area */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 0 80px',
      }}>
        {/* Prev button */}
        <button
          className="sogni-tv-nav"
          onClick={goPrev}
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            padding: 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            transition: 'opacity 0.2s',
            opacity: 0.5,
            zIndex: 5,
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.opacity = '1'; }}
          onMouseLeave={(e) => { (e.currentTarget).style.opacity = '0.5'; }}
          aria-label="Previous video"
        >
          ‹
        </button>

        <video
          ref={videoRef}
          key={currentUrl}
          src={currentUrl}
          autoPlay
          playsInline
          controls
          onEnded={goNext}
          style={{
            maxWidth: '90vw',
            maxHeight: 'calc(100vh - 160px)',
            borderRadius: 0,
            objectFit: 'contain',
            opacity: showStatic ? 0 : 1,
            transition: 'opacity 0.1s',
          }}
        />

        {/* Hidden preload element for next video */}
        <video
          ref={preloadRef}
          preload="auto"
          muted
          playsInline
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        />

        {/* Next button */}
        <button
          className="sogni-tv-nav"
          onClick={goNext}
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            padding: 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            transition: 'opacity 0.2s',
            opacity: 0.5,
            zIndex: 5,
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.opacity = '1'; }}
          onMouseLeave={(e) => { (e.currentTarget).style.opacity = '0.5'; }}
          aria-label="Next video"
        >
          ›
        </button>
      </div>

      {/* Bottom bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '16px 20px',
        zIndex: 30,
        background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
      }}>
        <span style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: '0.8rem',
          fontWeight: 500,
        }}>
          {currentIndex + 1} / {playlist.length}
        </span>
        {label && (
          <span style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: '0.85rem',
          }}>
            {label}
          </span>
        )}
      </div>

      {/* Render progress overlay (bottom-right countdown) */}
      <RenderProgressOverlay />
    </div>,
    document.body,
  );
}

// --- Main Component ---

export function SogniTV() {
  const [dismissed, setDismissed] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Listen for external open/close from the controller (chat offer integration)
  useEffect(() => {
    return sogniTVController.subscribe(() => {
      const { isOpen } = sogniTVController.getState();
      setPlayerOpen(isOpen);
    });
  }, []);

  const handleClose = useCallback(() => {
    setPlayerOpen(false);
    sogniTVController.close();
  }, []);

  if (playerOpen) {
    return <SogniTVPlayer onClose={handleClose} />;
  }

  if (dismissed) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes sogniTvBubbleIn {
          from { opacity: 0; transform: translateY(20px) scale(0.8); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sogniTvGlow {
          0%, 100% { box-shadow: 0 0 12px rgba(139,92,246,0.3), 0 4px 20px rgba(0,0,0,0.3); }
          50% { box-shadow: 0 0 20px rgba(139,92,246,0.5), 0 4px 20px rgba(0,0,0,0.3); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: 24,
          zIndex: 99998,
          animation: 'sogniTvBubbleIn 0.4s ease-out',
          display: 'flex',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Main TV button */}
        <button
          onClick={() => setPlayerOpen(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            background: isHovered
              ? 'linear-gradient(135deg, #7c3aed, #a855f7)'
              : 'linear-gradient(135deg, #6d28d9, #8b5cf6)',
            border: 'none',
            color: '#fff',
            width: 52,
            height: 52,
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'sogniTvGlow 3s ease-in-out infinite',
            transition: 'transform 0.2s, background 0.2s',
            transform: isHovered ? 'scale(1.08)' : 'scale(1)',
          }}
          title="SogniTV"
          aria-label="Open SogniTV"
        >
          <TVIcon size={22} />
        </button>

        {/* Dismiss X */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            background: '#333',
            border: '2px solid #222',
            color: '#999',
            width: 20,
            height: 20,
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.65rem',
            padding: 0,
            lineHeight: 1,
            transition: 'color 0.2s, background 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.background = '#555';
            (e.target as HTMLElement).style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = '#333';
            (e.target as HTMLElement).style.color = '#999';
          }}
          aria-label="Dismiss SogniTV"
        >
          ✕
        </button>
      </div>
    </>,
    document.body,
  );
}
