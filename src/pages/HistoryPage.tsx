import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { useGallery } from '@/hooks/useGallery';
import { SEOHead } from '@/components/seo/SEOHead';
import GalleryGrid from '@/components/gallery/GalleryGrid';
import GalleryCarousel from '@/components/gallery/GalleryCarousel';

export default function HistoryPage() {
  const { isAuthenticated } = useSogniAuth();
  const navigate = useNavigate();
  const gallery = useGallery();
  const { removeProject, loadFavorites } = gallery;
  const [activeTab, setActiveTab] = useState<'all' | 'favorites'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleInfoEnter = useCallback(() => {
    clearTimeout(tooltipTimeout.current);
    setShowInfoTooltip(true);
  }, []);

  const handleInfoLeave = useCallback(() => {
    tooltipTimeout.current = setTimeout(() => setShowInfoTooltip(false), 150);
  }, []);

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    await removeProject(projectId);
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
    }
  }, [removeProject, selectedProjectId]);

  const handleTabChange = useCallback((tab: 'all' | 'favorites') => {
    setActiveTab(tab);
    if (tab === 'favorites') {
      loadFavorites();
    }
  }, [loadFavorites]);

  if (!isAuthenticated) return null;

  return (
    <>
      <SEOHead
        title="My Media — Sogni Creative Agent"
        description="View your generated images, videos, and music."
      />
      <main className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 flex flex-col px-4 py-4">
          {/* Header with tabs */}
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: 'var(--color-text-primary)',
                  letterSpacing: '-0.02em',
                }}
              >
                My Media
              </h1>
              <button
                onMouseEnter={handleInfoEnter}
                onMouseLeave={handleInfoLeave}
                onFocus={handleInfoEnter}
                onBlur={handleInfoLeave}
                onClick={() => setShowInfoTooltip(prev => !prev)}
                aria-label="Storage information"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--color-text-tertiary)',
                  transition: 'color 0.15s ease',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </button>
              {showInfoTooltip && (
                <div
                  onMouseEnter={handleInfoEnter}
                  onMouseLeave={handleInfoLeave}
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    width: '300px',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    fontSize: '0.8125rem',
                    lineHeight: 1.5,
                    color: 'var(--color-text-secondary)',
                    zIndex: 50,
                  }}
                >
                  These files are stored locally in your browser. Your browser may delete them to make room, so download anything you want to keep.
                </div>
              )}
            </div>

            {/* Tab toggle - pill style */}
            <div
              style={{
                display: 'flex',
                gap: '2px',
                background: 'var(--color-bg-elevated)',
                borderRadius: 'var(--radius-md)',
                padding: '2px',
                border: '1px solid var(--color-border)',
              }}
            >
              <button
                onClick={() => handleTabChange('all')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeTab === 'all' ? 'var(--color-text-primary)' : 'transparent',
                  color: activeTab === 'all' ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                  transition: 'all 0.15s ease',
                }}
              >
                All
              </button>
              <button
                onClick={() => handleTabChange('favorites')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeTab === 'favorites' ? 'var(--color-text-primary)' : 'transparent',
                  color: activeTab === 'favorites' ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                  transition: 'all 0.15s ease',
                }}
              >
                Favorites
              </button>
            </div>
          </div>

          {/* Content */}
          {gallery.loading && !gallery.initialized ? (
            <div className="flex-1 flex items-center justify-center">
              <div
                className="animate-spin"
                style={{
                  width: 32,
                  height: 32,
                  border: '3px solid var(--color-border)',
                  borderTopColor: 'var(--color-text-primary)',
                  borderRadius: '50%',
                }}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <GalleryGrid
                projects={gallery.projects}
                favorites={gallery.favorites}
                activeTab={activeTab}
                onSelectProject={setSelectedProjectId}
                onDeleteProject={handleDeleteProject}
                getFirstResultUrl={gallery.getFirstResultUrl}
                onToggleFavorite={gallery.toggleFavorite}
              />
            </div>
          )}
        </div>
      </main>

      {/* Carousel overlay */}
      {selectedProjectId && (
        <GalleryCarousel
          projectId={selectedProjectId}
          getProjectDetail={gallery.getProjectDetail}
          onClose={() => setSelectedProjectId(null)}
          onToggleFavorite={gallery.toggleFavorite}
          onDeleteProject={handleDeleteProject}
        />
      )}
    </>
  );
}
