/**
 * GalleryProjectCard - A card displaying a gallery project with full-bleed
 * thumbnail, overlaid project info, and hover-reveal delete button.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { GalleryProject } from '@/types/gallery';
import DeleteConfirmPopup, { shouldSkipDeleteConfirm } from './DeleteConfirmPopup';
import { useLazyLoad } from '@/hooks/useLazyLoad';

const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

// ============================================================================
// Types
// ============================================================================

interface GalleryProjectCardProps {
  project: GalleryProject;
  onClick: () => void;
  onDelete: (projectId: string) => void;
  getFirstResultUrl: (projectId: string) => Promise<{ url: string; mediaType?: 'image' | 'video' | 'audio'; width?: number; height?: number } | null>;
  onThumbnailDimensions?: (projectId: string, width: number, height: number) => void;
  index?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatProjectDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatProjectDate(timestamp);
}

// ============================================================================
// Component
// ============================================================================

const GalleryProjectCard: React.FC<GalleryProjectCardProps> = ({
  project,
  onClick,
  onDelete,
  getFirstResultUrl,
  onThumbnailDimensions,
  index = 0,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailMediaType, setThumbnailMediaType] = useState<'image' | 'video' | 'audio' | undefined>();
  const [thumbnailLoading, setThumbnailLoading] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const deleteAnchorRef = useRef<HTMLDivElement | null>(null);
  const { ref: lazyRef, isVisible } = useLazyLoad({ rootMargin: '300px' });

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;

    getFirstResultUrl(project.id).then(result => {
      if (!cancelled) {
        setThumbnailUrl(result?.url ?? null);
        setThumbnailMediaType(result?.mediaType);
        if (result?.width && result?.height) {
          onThumbnailDimensions?.(project.id, result.width, result.height);
        }
        setThumbnailLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setThumbnailLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isVisible, project.id, getFirstResultUrl, onThumbnailDimensions]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (shouldSkipDeleteConfirm()) {
      onDelete(project.id);
    } else {
      setShowDeleteConfirm(true);
    }
  }, [onDelete, project.id]);

  const dateLabel = formatProjectDate(project.createdAt);
  const relativeTime = formatRelativeTime(project.createdAt);
  const resultLabel = `${project.numberOfResults} result${project.numberOfResults !== 1 ? 's' : ''}`;

  return (
    <div
      ref={lazyRef}
      onClick={onClick}
      onMouseEnter={() => {
        setIsHovered(true);
        if (thumbnailMediaType === 'video' && videoRef.current) {
          videoRef.current.play().catch(() => {});
          if (supportsHover) {
            videoRef.current.muted = false;
          }
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.muted = true;
        }
      }}
      style={{
        cursor: 'pointer',
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
      {/* Full-bleed thumbnail */}
      {thumbnailLoading ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'var(--color-bg-elevated)',
          }}
        />
      ) : thumbnailMediaType === 'audio' ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="40"
            height="40"
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
        </div>
      ) : thumbnailUrl && thumbnailMediaType === 'video' ? (
        <video
          ref={videoRef}
          src={thumbnailUrl}
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
      ) : thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={project.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'var(--color-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'var(--color-text-light)' }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      {/* Bottom gradient overlay with project info */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 65%, transparent 100%)',
          padding: '28px 12px 10px 12px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.88rem',
            fontWeight: 600,
            color: 'white',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: '2px',
            letterSpacing: '-0.02em',
          }}
        >
          {project.name || `Creation - ${dateLabel}`}
        </div>
        <span
          style={{
            fontFamily: 'var(--font-primary)',
            fontSize: '0.72rem',
            color: 'rgba(255, 255, 255, 0.7)',
            letterSpacing: '-0.01em',
          }}
        >
          {resultLabel} &middot; {relativeTime}
        </span>
      </div>

      {/* Delete button (hover-revealed, top-right) */}
      <div ref={deleteAnchorRef} style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2 }}>
        <button
          onClick={handleDelete}
          aria-label="Delete project"
          style={{
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
            opacity: isHovered || showDeleteConfirm ? 1 : 0,
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
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
        {showDeleteConfirm && (
          <DeleteConfirmPopup
            anchorRef={deleteAnchorRef}
            onConfirm={() => {
              setShowDeleteConfirm(false);
              onDelete(project.id);
            }}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}
      </div>
    </div>
  );
};

export default React.memo(GalleryProjectCard);
