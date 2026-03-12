/**
 * Gallery IndexedDB Wrapper
 *
 * Unified IndexedDB storage for the gallery architecture with 3 object stores:
 * projects, images, and sourceImages. Provides local-first persistence for
 * restoration history and favorites without any API dependency.
 */

import type {
  GalleryProject,
  GalleryImage,
  GallerySourceImage
} from '../types/gallery';

const DB_NAME = 'sogni_restoration_gallery';
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';
const IMAGES_STORE = 'images';
const SOURCE_IMAGES_STORE = 'sourceImages';

let dbInstance: IDBDatabase | null = null;

/**
 * Open the IndexedDB database, creating stores if needed.
 * Uses a singleton pattern with cached dbInstance for lazy init.
 */
function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[GALLERY DB] Failed to open database:', request.error);
      reject(new Error('Failed to open gallery database'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle database closing unexpectedly
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // Version 0->1: Create all stores
      if (oldVersion < 1) {
        const projectsStore = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
        projectsStore.createIndex('createdAt', 'createdAt', { unique: false });
        projectsStore.createIndex('updatedAt', 'updatedAt', { unique: false });

        const imagesStore = db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
        imagesStore.createIndex('projectId', 'projectId', { unique: false });
        imagesStore.createIndex('isFavorite', 'isFavorite', { unique: false });
        imagesStore.createIndex('createdAt', 'createdAt', { unique: false });

        db.createObjectStore(SOURCE_IMAGES_STORE, { keyPath: 'id' });
      }

      // Version 1->2: Add mediaType index to images store
      if (oldVersion < 2) {
        const transaction = (event.target as IDBOpenDBRequest).transaction!;
        const imagesStore = transaction.objectStore(IMAGES_STORE);
        imagesStore.createIndex('mediaType', 'mediaType', { unique: false });
      }
    };
  });
}

// ============================================================================
// Source Image Operations
// ============================================================================

/**
 * Save a source image to the sourceImages store
 */
export async function saveSourceImage(sourceImage: GallerySourceImage): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SOURCE_IMAGES_STORE, 'readwrite');
    const store = transaction.objectStore(SOURCE_IMAGES_STORE);
    const request = store.put(sourceImage);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to save source image:', request.error);
      reject(new Error('Failed to save source image'));
    };
  });
}

/**
 * Get a source image by ID
 */
export async function getSourceImage(id: string): Promise<GallerySourceImage | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SOURCE_IMAGES_STORE, 'readonly');
    const store = transaction.objectStore(SOURCE_IMAGES_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to get source image:', request.error);
      reject(new Error('Failed to load source image'));
    };
  });
}

// ============================================================================
// Project Operations
// ============================================================================

/**
 * Save a project to the projects store
 */
export async function saveProject(project: GalleryProject): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_STORE, 'readwrite');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to save project:', request.error);
      reject(new Error('Failed to save project'));
    };
  });
}

/**
 * Get all projects, sorted by updatedAt descending (newest first)
 */
export async function getAllProjects(): Promise<GalleryProject[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_STORE, 'readonly');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const projects = (request.result as GalleryProject[]).sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      resolve(projects);
    };

    request.onerror = () => {
      console.error('[GALLERY DB] Failed to get projects:', request.error);
      reject(new Error('Failed to load projects'));
    };
  });
}

/**
 * Get a single project by ID
 */
export async function getProject(id: string): Promise<GalleryProject | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_STORE, 'readonly');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to get project:', request.error);
      reject(new Error('Failed to load project'));
    };
  });
}

/**
 * Delete a project and cascade-delete all its images and source image.
 * Uses a single multi-store transaction for atomicity.
 */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();

  // First, get the project to find the sourceImageId
  const project = await getProject(id);
  if (!project) {
    return;
  }

  // Get all images for the project to delete them
  const images = await getProjectImages(id);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [PROJECTS_STORE, IMAGES_STORE, SOURCE_IMAGES_STORE],
      'readwrite'
    );

    transaction.onerror = () => {
      console.error('[GALLERY DB] Failed to delete project:', transaction.error);
      reject(new Error('Failed to delete project'));
    };

    transaction.oncomplete = () => resolve();

    // Delete all images for this project
    const imagesStore = transaction.objectStore(IMAGES_STORE);
    for (const image of images) {
      imagesStore.delete(image.id);
    }

    // Delete the source image
    const sourceImagesStore = transaction.objectStore(SOURCE_IMAGES_STORE);
    sourceImagesStore.delete(project.sourceImageId);

    // Delete the project itself
    const projectsStore = transaction.objectStore(PROJECTS_STORE);
    projectsStore.delete(id);
  });
}

// ============================================================================
// Image Operations
// ============================================================================

/**
 * Save an image to the images store
 */
export async function saveImage(image: GalleryImage): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE);
    const request = store.put(image);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to save image:', request.error);
      reject(new Error('Failed to save image'));
    };
  });
}

/**
 * Get all images for a project, sorted by index ascending
 */
export async function getProjectImages(projectId: string): Promise<GalleryImage[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readonly');
    const store = transaction.objectStore(IMAGES_STORE);
    const index = store.index('projectId');
    const request = index.getAll(projectId);

    request.onsuccess = () => {
      const images = (request.result as GalleryImage[]).sort(
        (a, b) => a.index - b.index
      );
      resolve(images);
    };

    request.onerror = () => {
      console.error('[GALLERY DB] Failed to get project images:', request.error);
      reject(new Error('Failed to load project images'));
    };
  });
}

/**
 * Get all favorited images, sorted by createdAt descending (newest first).
 * IndexedDB stores booleans as 0/1 internally, so we query with IDBKeyRange.only(1).
 */
export async function getFavoriteImages(): Promise<GalleryImage[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readonly');
    const store = transaction.objectStore(IMAGES_STORE);
    const index = store.index('isFavorite');
    // IndexedDB converts booleans to 0/1, so query with 1 for true
    const request = index.getAll(IDBKeyRange.only(1));

    request.onsuccess = () => {
      const images = (request.result as GalleryImage[]).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      resolve(images);
    };

    request.onerror = () => {
      console.error('[GALLERY DB] Failed to get favorite images:', request.error);
      reject(new Error('Failed to load favorite images'));
    };
  });
}

/**
 * Toggle the isFavorite flag on an image.
 * Uses a single readwrite transaction (get then put) for atomicity.
 * Returns the new isFavorite value.
 */
export async function toggleFavorite(imageId: string): Promise<boolean> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE);
    const getRequest = store.get(imageId);

    getRequest.onsuccess = () => {
      const image = getRequest.result as GalleryImage | undefined;
      if (!image) {
        reject(new Error('Image not found'));
        return;
      }

      const newFavorite = !image.isFavorite;
      image.isFavorite = newFavorite;

      const putRequest = store.put(image);
      putRequest.onsuccess = () => resolve(newFavorite);
      putRequest.onerror = () => {
        console.error('[GALLERY DB] Failed to toggle favorite:', putRequest.error);
        reject(new Error('Failed to toggle favorite'));
      };
    };

    getRequest.onerror = () => {
      console.error('[GALLERY DB] Failed to get image for favorite toggle:', getRequest.error);
      reject(new Error('Failed to toggle favorite'));
    };
  });
}

/**
 * Get a single image by ID
 */
export async function getImage(id: string): Promise<GalleryImage | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readonly');
    const store = transaction.objectStore(IMAGES_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to get image:', request.error);
      reject(new Error('Failed to load image'));
    };
  });
}

/**
 * Find a gallery image by its Sogni SDK job ID.
 * Used to link results on the restore page back to saved gallery images.
 */
export async function getImageBySdkJobId(sdkJobId: string): Promise<GalleryImage | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readonly');
    const store = transaction.objectStore(IMAGES_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const images = request.result as GalleryImage[];
      const match = images.find(img => img.sdkJobId === sdkJobId);
      resolve(match || null);
    };
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to search images by SDK job ID:', request.error);
      reject(new Error('Failed to search images'));
    };
  });
}

/**
 * Delete a single image from the images store
 */
export async function deleteImage(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE, 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('[GALLERY DB] Failed to delete image:', request.error);
      reject(new Error('Failed to delete image'));
    };
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if IndexedDB is supported in the current environment
 */
export function isIndexedDBSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
