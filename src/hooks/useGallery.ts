/**
 * useGallery Hook
 *
 * Main state management hook for the gallery feature. Provides CRUD operations
 * for projects and images, favorites management, blob URL caching with cleanup,
 * and cross-tab synchronization via BroadcastChannel.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getAllProjects,
  getProjectImages,
  getSourceImage,
  getFavoriteImages,
  toggleFavorite as dbToggleFavorite,
  deleteProject as dbDeleteProject,
  deleteImage as dbDeleteImage,
  isIndexedDBSupported,
} from '@/utils/galleryDB';
import type {
  GalleryProject,
  GalleryImage,
  GalleryProjectWithImages,
  GalleryState,
} from '@/types/gallery';

// ============================================================================
// Types
// ============================================================================

export interface UseGalleryReturn {
  // State
  projects: GalleryProject[];
  loading: boolean;
  initialized: boolean;
  error: string | null;

  // Project operations
  getProjectDetail: (projectId: string) => Promise<GalleryProjectWithImages | null>;
  removeProject: (projectId: string) => Promise<boolean>;

  // Image operations
  toggleFavorite: (imageId: string) => Promise<boolean>;
  removeImage: (imageId: string) => Promise<boolean>;

  // Favorites
  favorites: GalleryImage[];
  loadFavorites: () => Promise<void>;

  // Thumbnail helpers
  getSourceImageUrl: (sourceImageId: string) => Promise<string | null>;
  getFirstResultUrl: (projectId: string) => Promise<{ url: string; mediaType?: 'image' | 'video' } | null>;

  // Refresh
  refresh: () => Promise<void>;

  isSupported: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const BROADCAST_CHANNEL_NAME = 'sogni-gallery-sync';

// ============================================================================
// Cross-tab sync helper
// ============================================================================

let ignoreNextBroadcast = false;

function notifyOtherTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;

  try {
    ignoreNextBroadcast = true;
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.postMessage({ type: 'gallery-updated' });
    channel.close();
    Promise.resolve().then(() => { ignoreNextBroadcast = false; });
  } catch (error) {
    ignoreNextBroadcast = false;
    console.warn('[GALLERY] Failed to notify other tabs:', error);
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useGallery(): UseGalleryReturn {
  const [state, setState] = useState<GalleryState>({
    projects: [],
    loading: false,
    initialized: false,
    error: null,
  });

  const [favorites, setFavorites] = useState<GalleryImage[]>([]);

  const isSupported = isIndexedDBSupported();
  const loadingRef = useRef(false);

  // Blob URL cache: key = "source-{id}" or "thumb-{projectId}", value = blob URL
  const blobUrlCacheRef = useRef<Map<string, string>>(new Map());

  // ------------------------------------------------------------------
  // Load projects from IndexedDB
  // ------------------------------------------------------------------

  const loadProjects = useCallback(async () => {
    if (!isSupported || loadingRef.current) return;

    loadingRef.current = true;
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const projects = await getAllProjects();
      setState({
        projects,
        loading: false,
        initialized: true,
        error: null,
      });
    } catch (error) {
      console.error('[GALLERY] Failed to load projects:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        initialized: true,
        error: error instanceof Error ? error.message : 'Failed to load gallery projects',
      }));
    } finally {
      loadingRef.current = false;
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Load favorites from IndexedDB
  // ------------------------------------------------------------------

  const loadFavorites = useCallback(async () => {
    if (!isSupported) return;

    try {
      const favs = await getFavoriteImages();
      setFavorites(favs);
    } catch (error) {
      console.error('[GALLERY] Failed to load favorites:', error);
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Get full project detail (project + source image + result images)
  // ------------------------------------------------------------------

  const getProjectDetail = useCallback(async (
    projectId: string
  ): Promise<GalleryProjectWithImages | null> => {
    if (!isSupported) return null;

    try {
      const projects = await getAllProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return null;

      const [images, sourceImage] = await Promise.all([
        getProjectImages(projectId),
        getSourceImage(project.sourceImageId),
      ]);

      if (!sourceImage) {
        console.error('[GALLERY] Source image not found for project:', projectId);
        return null;
      }

      return { project, sourceImage, images };
    } catch (error) {
      console.error('[GALLERY] Failed to get project detail:', error);
      return null;
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Remove a project (cascade deletes images + source image via DB)
  // ------------------------------------------------------------------

  const removeProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const images = await getProjectImages(projectId);

      await dbDeleteProject(projectId);

      // Clean blob URL cache entries for this project
      const cache = blobUrlCacheRef.current;
      const thumbKey = `thumb-${projectId}`;
      if (cache.has(thumbKey)) {
        URL.revokeObjectURL(cache.get(thumbKey)!);
        cache.delete(thumbKey);
      }

      setState(prev => {
        const project = prev.projects.find(p => p.id === projectId);
        if (project) {
          const sourceKey = `source-${project.sourceImageId}`;
          if (cache.has(sourceKey)) {
            URL.revokeObjectURL(cache.get(sourceKey)!);
            cache.delete(sourceKey);
          }
        }
        return {
          ...prev,
          projects: prev.projects.filter(p => p.id !== projectId),
        };
      });

      const projectImageIds = new Set(images.map(img => img.id));
      setFavorites(prev => prev.filter(fav => !projectImageIds.has(fav.id)));

      notifyOtherTabs();
      return true;
    } catch (error) {
      console.error('[GALLERY] Failed to remove project:', error);
      return false;
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Toggle favorite on an image
  // ------------------------------------------------------------------

  const toggleFavorite = useCallback(async (imageId: string): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const newValue = await dbToggleFavorite(imageId);

      if (newValue) {
        await loadFavorites();
      } else {
        setFavorites(prev => prev.filter(fav => fav.id !== imageId));
      }

      notifyOtherTabs();
      return newValue;
    } catch (error) {
      console.error('[GALLERY] Failed to toggle favorite:', error);
      return false;
    }
  }, [isSupported, loadFavorites]);

  // ------------------------------------------------------------------
  // Remove a single image
  // ------------------------------------------------------------------

  const removeImage = useCallback(async (imageId: string): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const cache = blobUrlCacheRef.current;
      Array.from(cache.entries()).forEach(([key, url]) => {
        if (key.includes(imageId)) {
          URL.revokeObjectURL(url);
          cache.delete(key);
        }
      });

      await dbDeleteImage(imageId);

      setFavorites(prev => prev.filter(fav => fav.id !== imageId));

      notifyOtherTabs();
      return true;
    } catch (error) {
      console.error('[GALLERY] Failed to remove image:', error);
      return false;
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Get a blob URL for a source image (cached)
  // ------------------------------------------------------------------

  const getSourceImageUrl = useCallback(async (
    sourceImageId: string
  ): Promise<string | null> => {
    if (!isSupported) return null;

    const cacheKey = `source-${sourceImageId}`;
    const cache = blobUrlCacheRef.current;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const sourceImage = await getSourceImage(sourceImageId);
      if (!sourceImage) return null;

      const url = URL.createObjectURL(sourceImage.blob);
      cache.set(cacheKey, url);
      return url;
    } catch (error) {
      console.error('[GALLERY] Failed to get source image URL:', error);
      return null;
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Get a blob URL for the first result image of a project (cached)
  // ------------------------------------------------------------------

  const getFirstResultUrl = useCallback(async (
    projectId: string
  ): Promise<{ url: string; mediaType?: 'image' | 'video'; width?: number; height?: number } | null> => {
    if (!isSupported) return null;

    const cacheKey = `thumb-${projectId}`;
    const cache = blobUrlCacheRef.current;

    const cached = cache.get(cacheKey);
    if (cached) {
      const [url, mediaType, w, h] = cached.split('|');
      return {
        url,
        mediaType: (mediaType as 'image' | 'video') || undefined,
        width: w ? parseInt(w, 10) : undefined,
        height: h ? parseInt(h, 10) : undefined,
      };
    }

    try {
      const images = await getProjectImages(projectId);
      if (images.length === 0) return null;

      const firstImage = images[0];
      const url = URL.createObjectURL(firstImage.blob);
      cache.set(cacheKey, `${url}|${firstImage.mediaType || ''}|${firstImage.width || ''}|${firstImage.height || ''}`);
      return { url, mediaType: firstImage.mediaType, width: firstImage.width, height: firstImage.height };
    } catch (error) {
      console.error('[GALLERY] Failed to get first result URL:', error);
      return null;
    }
  }, [isSupported]);

  // ------------------------------------------------------------------
  // Refresh projects and favorites
  // ------------------------------------------------------------------

  const refresh = useCallback(async () => {
    await Promise.all([loadProjects(), loadFavorites()]);
  }, [loadProjects, loadFavorites]);

  // ------------------------------------------------------------------
  // Initialization: load projects and favorites on mount
  // ------------------------------------------------------------------

  useEffect(() => {
    loadProjects();
    loadFavorites();
  }, [loadProjects, loadFavorites]);

  // ------------------------------------------------------------------
  // Cross-tab sync: listen for changes from other tabs
  // ------------------------------------------------------------------

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    let channel: BroadcastChannel;

    try {
      channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

      channel.onmessage = () => {
        if (ignoreNextBroadcast) {
          ignoreNextBroadcast = false;
          return;
        }
        loadProjects();
        loadFavorites();
      };
    } catch (error) {
      console.warn('[GALLERY] Failed to set up cross-tab sync:', error);
      return;
    }

    return () => {
      try {
        channel.close();
      } catch {
        // Channel may already be closed
      }
    };
  }, [loadProjects, loadFavorites]);

  // ------------------------------------------------------------------
  // Blob URL cleanup on unmount
  // ------------------------------------------------------------------

  useEffect(() => {
    const cache = blobUrlCacheRef.current;

    return () => {
      Array.from(cache.values()).forEach(url => {
        URL.revokeObjectURL(url);
      });
      cache.clear();
    };
  }, []);

  // ------------------------------------------------------------------
  // Return
  // ------------------------------------------------------------------

  return {
    projects: state.projects,
    loading: state.loading,
    initialized: state.initialized,
    error: state.error,

    getProjectDetail,
    removeProject,

    toggleFavorite,
    removeImage,

    favorites,
    loadFavorites,

    getSourceImageUrl,
    getFirstResultUrl,

    refresh,

    isSupported,
  };
}

export default useGallery;
