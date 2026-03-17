/**
 * GalleryGrid - Justified image grid for both project cards and favorites.
 *
 * Each row fills the full container width. All tiles in a row share the same
 * height, with widths determined by each tile's aspect ratio.
 */

import React, { useMemo, useState, useCallback } from 'react';
import type { GalleryProject, GalleryImage } from '@/types/gallery';
import GalleryProjectCard from './GalleryProjectCard';
import GalleryImageCard from './GalleryImageCard';
import { useJustifiedLayout } from '@/hooks/useJustifiedLayout';

// ============================================================================
// Types
// ============================================================================

interface GalleryGridProps {
  projects: GalleryProject[];
  favorites: GalleryImage[];
  activeTab: 'all' | 'favorites';
  onSelectProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  getFirstResultUrl: (projectId: string) => Promise<{ url: string; mediaType?: 'image' | 'video' | 'audio'; width?: number; height?: number } | null>;
  onToggleFavorite: (imageId: string) => Promise<boolean>;
}

// ============================================================================
// Empty State Components
// ============================================================================

const EmptyAllState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4rem 2rem',
      textAlign: 'center',
    }}
  >
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--color-text-light)', marginBottom: '1rem' }}
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
      No creations yet
    </p>
    <p style={{ fontFamily: 'var(--font-primary)', fontSize: '0.88rem', color: 'var(--color-text-tertiary)', maxWidth: '280px', lineHeight: 1.5 }}>
      Your generated images, videos, and music will appear here
    </p>
  </div>
);

const EmptyFavoritesState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4rem 2rem',
      textAlign: 'center',
    }}
  >
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--color-text-light)', marginBottom: '1rem' }}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
      No favorites yet
    </p>
    <p style={{ fontFamily: 'var(--font-primary)', fontSize: '0.88rem', color: 'var(--color-text-tertiary)', maxWidth: '280px', lineHeight: 1.5 }}>
      Tap the heart on any image to add it here
    </p>
  </div>
);

// ============================================================================
// Component
// ============================================================================

const GalleryGrid: React.FC<GalleryGridProps> = ({
  projects,
  favorites,
  activeTab,
  onSelectProject,
  onDeleteProject,
  getFirstResultUrl,
  onToggleFavorite,
}) => {
  const [projectDims, setProjectDims] = useState<Map<string, { width: number; height: number }>>(new Map());

  const handleProjectDimensions = useCallback((projectId: string, width: number, height: number) => {
    setProjectDims(prev => {
      const existing = prev.get(projectId);
      if (existing && existing.width === width && existing.height === height) return prev;
      const next = new Map(prev);
      next.set(projectId, { width, height });
      return next;
    });
  }, []);

  // Justified layout - projects
  const projectItems = useMemo(
    () => projects.map(p => projectDims.get(p.id) || { width: 4, height: 3 }),
    [projects, projectDims],
  );
  const { containerRef: projRef, layout: projLayout } = useJustifiedLayout(projectItems, {
    targetRowHeight: 240,
    gap: 8,
  });

  // Justified layout - favorites
  const favItems = useMemo(
    () => favorites.map(img => ({ width: img.width || 1, height: img.height || 1 })),
    [favorites],
  );
  const { containerRef: favRef, layout: favLayout } = useJustifiedLayout(favItems, {
    targetRowHeight: 240,
    gap: 8,
  });

  // All Projects Tab
  if (activeTab === 'all') {
    if (projects.length === 0) return <EmptyAllState />;

    return (
      <div
        ref={projRef}
        style={{
          position: 'relative',
          width: '100%',
          height: projLayout.containerHeight > 0 ? projLayout.containerHeight : undefined,
        }}
      >
        {projects.map((project, idx) => {
          const box = projLayout.boxes[idx];
          if (!box) return null;
          return (
            <div
              key={project.id}
              style={{
                position: 'absolute',
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
                transition: 'top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease',
              }}
            >
              <GalleryProjectCard
                project={project}
                onClick={() => onSelectProject(project.id)}
                onDelete={onDeleteProject}
                getFirstResultUrl={getFirstResultUrl}
                onThumbnailDimensions={handleProjectDimensions}
                index={idx}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // Favorites Tab
  if (favorites.length === 0) return <EmptyFavoritesState />;

  return (
    <div
      ref={favRef}
      style={{
        position: 'relative',
        width: '100%',
        height: favLayout.containerHeight > 0 ? favLayout.containerHeight : undefined,
      }}
    >
      {favorites.map((image, idx) => {
        const box = favLayout.boxes[idx];
        if (!box) return null;
        return (
          <div
            key={image.id}
            style={{
              position: 'absolute',
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.height,
            }}
          >
            <GalleryImageCard
              image={image}
              onToggleFavorite={onToggleFavorite}
              index={idx}
            />
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(GalleryGrid);
