/**
 * GalleryCarousel - Fullscreen horizontal carousel overlay for browsing
 * project images/videos. Portal-based, scroll-snap, keyboard navigable.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { GalleryProjectWithImages, GalleryImage } from '@/types/gallery';
import { downloadBlob } from '@/utils/download';
import { buildDownloadFilename } from '@/utils/downloadFilename';

interface GalleryCarouselProps {
  projectId: string;
  getProjectDetail: (projectId: string) => Promise<GalleryProjectWithImages | null>;
  onClose: () => void;
  onToggleFavorite: (imageId: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => void;
}

interface SlideItem {
  type: 'source' | 'result';
  url: string;
  mediaType: 'image' | 'video' | 'audio';
  image?: GalleryImage;
  label?: string;
}

const glassButton: React.CSSProperties = {
  zIndex: 10,
  background: 'rgba(255, 255, 255, 0.15)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '50%',
  width: '44px',
  height: '44px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'white',
  transition: 'background 0.2s',
};

export default function GalleryCarousel({
  projectId,
  getProjectDetail,
  onClose,
  onToggleFavorite,
  onDeleteProject,
}: GalleryCarouselProps) {
  const [data, setData] = useState<GalleryProjectWithImages | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  const blobUrlsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  // Load project data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getProjectDetail(projectId)
      .then(result => {
        if (cancelled) return;
        if (!result) {
          setError('Project not found');
          setLoading(false);
          return;
        }

        setData(result);

        const newSlides: SlideItem[] = [];
        const urls: string[] = [];

        // Source image (skip placeholder blobs that have no real content)
        if (result.sourceImage.blob.size > 0) {
          const srcUrl = URL.createObjectURL(result.sourceImage.blob);
          urls.push(srcUrl);
          newSlides.push({
            type: 'source',
            url: srcUrl,
            mediaType: 'image',
            label: 'Original',
          });
        }

        // Result images/videos
        for (const img of result.images) {
          const url = URL.createObjectURL(img.blob);
          urls.push(url);
          newSlides.push({
            type: 'result',
            url,
            mediaType: img.mediaType || 'image',
            image: img,
          });
        }

        blobUrlsRef.current = urls;
        setSlides(newSlides);

        const favs: Record<string, boolean> = {};
        for (const img of result.images) {
          favs[img.id] = img.isFavorite;
        }
        setFavorites(favs);

        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[GALLERY CAROUSEL] Failed to load project:', err);
        setError('Failed to load project');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectId, getProjectDetail]);

  // Revoke blob URLs on unmount
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Track current slide via IntersectionObserver
  useEffect(() => {
    if (!scrollRef.current || slides.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLDivElement);
            if (idx !== -1) setCurrentIndex(idx);
          }
        }
      },
      { root: scrollRef.current, threshold: 0.5 },
    );

    for (const ref of slideRefs.current) {
      if (ref) observerRef.current.observe(ref);
    }

    return () => { observerRef.current?.disconnect(); };
  }, [slides]);

  // Pause non-current videos
  useEffect(() => {
    for (const [idx, video] of videoRefs.current.entries()) {
      if (idx === currentIndex) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, [currentIndex]);

  const scrollToSlide = useCallback((idx: number) => {
    if (idx < 0 || idx >= slides.length) return;
    slideRefs.current[idx]?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'nearest', inline: 'center' });
  }, [slides.length]);

  const scrollToSlideRef = useRef(scrollToSlide);
  scrollToSlideRef.current = scrollToSlide;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') scrollToSlideRef.current(currentIndexRef.current - 1);
      else if (e.key === 'ArrowRight') scrollToSlideRef.current(currentIndexRef.current + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleFavoriteToggle = useCallback(async (imageId: string) => {
    const prev = favorites[imageId];
    setFavorites(f => ({ ...f, [imageId]: !prev }));
    try {
      const result = await onToggleFavorite(imageId);
      setFavorites(f => ({ ...f, [imageId]: result }));
    } catch {
      setFavorites(f => ({ ...f, [imageId]: prev }));
    }
  }, [favorites, onToggleFavorite]);

  const handleDownload = useCallback(() => {
    const slide = slides[currentIndex];
    if (!slide) return;

    if (slide.type === 'source' && data) {
      downloadBlob(data.sourceImage.blob, buildDownloadFilename(data.project.name || undefined, undefined, 'original'));
    } else if (slide.image && data) {
      const type = slide.mediaType === 'video' ? 'video' as const
        : slide.mediaType === 'audio' ? 'audio' as const
        : 'restored' as const;
      downloadBlob(slide.image.blob, buildDownloadFilename(data.project.name || undefined, slide.image.index + 1, type));
    }
  }, [slides, currentIndex, data]);

  const handleDelete = useCallback(() => {
    onDeleteProject(projectId);
    onClose();
  }, [onDeleteProject, projectId, onClose]);

  const currentSlide = slides[currentIndex];
  const currentImage = currentSlide?.image;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close"
        style={{ ...glassButton, position: 'absolute', top: '1rem', right: '1rem', zIndex: 20 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Loading / Error states */}
      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="animate-spin"
            style={{
              width: 40,
              height: 40,
              border: '3px solid rgba(255,255,255,0.2)',
              borderTopColor: 'white',
              borderRadius: '50%',
            }}
          />
        </div>
      )}

      {error && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '1rem' }}>
          {error}
        </div>
      )}

      {/* Horizontal scroll container */}
      {!loading && !error && slides.length > 0 && (
        <>
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              display: 'flex',
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollSnapType: 'x mandatory',
              scrollBehavior: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}
          >
            <style>{`
              .carousel-scroll::-webkit-scrollbar { display: none; }
            `}</style>
            {slides.map((slide, idx) => (
              <div
                key={idx}
                ref={(el) => { slideRefs.current[idx] = el; }}
                className="carousel-scroll"
                style={{
                  flexShrink: 0,
                  scrollSnapAlign: 'center',
                  width: '100vw',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1rem',
                  position: 'relative',
                }}
              >
                {slide.mediaType === 'audio' ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '24px',
                  }}>
                    <svg
                      width="64"
                      height="64"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: 'rgba(255,255,255,0.5)' }}
                    >
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    <audio
                      src={slide.url}
                      controls
                      autoPlay={idx === currentIndex}
                      style={{ width: '320px' }}
                    />
                  </div>
                ) : slide.mediaType === 'video' ? (
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(idx, el);
                      else videoRefs.current.delete(idx);
                    }}
                    src={slide.url}
                    autoPlay={idx === 0}
                    loop
                    playsInline
                    controls
                    style={{
                      maxHeight: '90vh',
                      maxWidth: '90vw',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                      borderRadius: 0,
                    }}
                  />
                ) : (
                  <img
                    src={slide.url}
                    alt={slide.label || `Result ${idx}`}
                    style={{
                      maxHeight: '90vh',
                      maxWidth: '90vw',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                      borderRadius: 0,
                    }}
                  />
                )}

                {/* "Original" badge */}
                {slide.type === 'source' && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '1.5rem',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'rgba(0, 0, 0, 0.6)',
                      backdropFilter: 'blur(4px)',
                      color: 'white',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '4px 12px',
                      borderRadius: '4px',
                      fontFamily: 'var(--font-primary)',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Original
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Arrow navigation */}
          {slides.length > 1 && (
            <>
              <button
                onClick={() => scrollToSlide(currentIndex - 1)}
                aria-label="Previous"
                style={{
                  ...glassButton,
                  position: 'absolute',
                  left: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: currentIndex === 0 ? 0.3 : 1,
                  pointerEvents: currentIndex === 0 ? 'none' : 'auto',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15,18 9,12 15,6" />
                </svg>
              </button>
              <button
                onClick={() => scrollToSlide(currentIndex + 1)}
                aria-label="Next"
                style={{
                  ...glassButton,
                  position: 'absolute',
                  right: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: currentIndex === slides.length - 1 ? 0.3 : 1,
                  pointerEvents: currentIndex === slides.length - 1 ? 'none' : 'auto',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9,18 15,12 9,6" />
                </svg>
              </button>
            </>
          )}

          {/* Bottom bar */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '0.75rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
              zIndex: 15,
            }}
          >
            {/* Left: project name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
              <span
                style={{
                  color: 'white',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  fontFamily: 'var(--font-display)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '200px',
                }}
              >
                {data?.project.name || 'Creation'}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8125rem', fontWeight: 500, flexShrink: 0 }}>
                {currentIndex + 1} / {slides.length}
              </span>
            </div>

            {/* Right: actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {/* Favorite toggle */}
              {currentImage && (
                <button
                  onClick={() => handleFavoriteToggle(currentImage.id)}
                  aria-label={favorites[currentImage.id] ? 'Remove from favorites' : 'Add to favorites'}
                  style={{
                    ...glassButton,
                    width: '36px',
                    height: '36px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
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
                    style={{ color: favorites[currentImage.id] ? '#ef4444' : 'white' }}
                  >
                    <path
                      d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                      fill={favorites[currentImage.id] ? 'currentColor' : 'none'}
                    />
                  </svg>
                </button>
              )}

              {/* Download */}
              <button
                onClick={handleDownload}
                aria-label="Download"
                style={{
                  ...glassButton,
                  borderRadius: 'var(--radius-md)',
                  width: 'auto',
                  padding: '0.4rem 0.75rem',
                  gap: '0.375rem',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>

              {/* Delete */}
              <button
                onClick={handleDelete}
                aria-label="Delete project"
                style={{
                  ...glassButton,
                  borderRadius: 'var(--radius-md)',
                  width: 'auto',
                  padding: '0.4rem 0.75rem',
                  gap: '0.375rem',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(192, 57, 43, 0.4)';
                  e.currentTarget.style.borderColor = 'rgba(192, 57, 43, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
