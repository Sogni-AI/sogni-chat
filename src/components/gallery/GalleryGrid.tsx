/**
 * GalleryGrid - Justified image grid for both project cards and favorites.
 *
 * Each row fills the full container width. All tiles in a row share the same
 * height, with widths determined by each tile's aspect ratio.
 */

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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

const PAGE_SIZE = 20;

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
  const [projPage, setProjPage] = useState(1);
  const [favPage, setFavPage] = useState(1);
  const projSentinelRef = useRef<HTMLDivElement>(null);
  const favSentinelRef = useRef<HTMLDivElement>(null);

  const handleProjectDimensions = useCallback((projectId: string, width: number, height: number) => {
    setProjectDims(prev => {
      const existing = prev.get(projectId);
      if (existing && existing.width === width && existing.height === height) return prev;
      const next = new Map(prev);
      next.set(projectId, { width, height });
      return next;
    });
  }, []);

  // Paginated subsets
  const visibleProjects = useMemo(
    () => projects.slice(0, projPage * PAGE_SIZE),
    [projects, projPage],
  );
  const visibleFavorites = useMemo(
    () => favorites.slice(0, favPage * PAGE_SIZE),
    [favorites, favPage],
  );

  // Justified layout - only for visible (paginated) items
  const projectItems = useMemo(
    () => visibleProjects.map(p => projectDims.get(p.id) || { width: 4, height: 3 }),
    [visibleProjects, projectDims],
  );
  const { containerRef: projRef, layout: projLayout } = useJustifiedLayout(projectItems, {
    targetRowHeight: 240,
    gap: 8,
  });

  const favItems = useMemo(
    () => visibleFavorites.map(img => ({ width: img.width || 1, height: img.height || 1 })),
    [visibleFavorites],
  );
  const { containerRef: favRef, layout: favLayout } = useJustifiedLayout(favItems, {
    targetRowHeight: 240,
    gap: 8,
  });

  // Load more projects when sentinel enters viewport
  useEffect(() => {
    if (activeTab !== 'all') return;
    if (projPage * PAGE_SIZE >= projects.length) return;

    const sentinel = projSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setProjPage(prev => prev + 1);
        }
      },
      { rootMargin: '600px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, projPage, projects.length]);

  // Load more favorites when sentinel enters viewport
  useEffect(() => {
    if (activeTab !== 'favorites') return;
    if (favPage * PAGE_SIZE >= favorites.length) return;

    const sentinel = favSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setFavPage(prev => prev + 1);
        }
      },
      { rootMargin: '600px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, favPage, favorites.length]);

  // All Projects Tab
  if (activeTab === 'all') {
    if (projects.length === 0) return <EmptyAllState />;

    const hasMoreProjects = projPage * PAGE_SIZE < projects.length;

    return (
      <div
        ref={projRef}
        style={{
          position: 'relative',
          width: '100%',
          height: projLayout.containerHeight > 0 ? projLayout.containerHeight : undefined,
        }}
      >
        {visibleProjects.map((project, idx) => {
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
        {hasMoreProjects && (
          <div
            ref={projSentinelRef}
            style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '1px' }}
          />
        )}
      </div>
    );
  }

  // Favorites Tab
  if (favorites.length === 0) return <EmptyFavoritesState />;

  const hasMoreFavorites = favPage * PAGE_SIZE < favorites.length;

  return (
    <div
      ref={favRef}
      style={{
        position: 'relative',
        width: '100%',
        height: favLayout.containerHeight > 0 ? favLayout.containerHeight : undefined,
      }}
    >
      {visibleFavorites.map((image, idx) => {
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
      {hasMoreFavorites && (
        <div
          ref={favSentinelRef}
          style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '1px' }}
        />
      )}
    </div>
  );
};

export default React.memo(GalleryGrid);
