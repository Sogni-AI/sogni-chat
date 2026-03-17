/**
 * Gallery Types - Data models for the local-first IndexedDB gallery architecture
 *
 * Defines the schema for a unified IndexedDB database with 3 object stores:
 * projects, images, and sourceImages. Favorites are tracked as a boolean flag
 * on individual gallery images rather than a separate store.
 */

export interface GalleryProject {
  /** Unique project ID (UUID) */
  id: string;
  /** User-defined project name */
  name: string;
  /** ID of the source image used for restoration */
  sourceImageId: string;
  /** AI model used for restoration */
  model: string;
  /** Prompt sent to the restoration model */
  prompt: string;
  /** Number of restoration results generated */
  numberOfResults: number;
  /** Timestamp when project was created */
  createdAt: number;
  /** Timestamp when project was last modified */
  updatedAt: number;
}

export interface GalleryImage {
  /** Unique image ID (UUID) */
  id: string;
  /** Project ID this image belongs to */
  projectId: string;
  /** Image blob data */
  blob: Blob;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** MIME type (e.g., 'image/jpeg', 'image/png') */
  mimeType: string;
  /** Position index within the project's result set */
  index: number;
  /** Whether this image has been favorited by the user */
  isFavorite: boolean;
  /** Timestamp when image was created */
  createdAt: number;
  /** Sogni SDK job ID that produced this image */
  sdkJobId?: string;
  /** Media type: 'image' (default), 'video', or 'audio' */
  mediaType?: 'image' | 'video' | 'audio';
  /** Video duration in seconds (only for video type) */
  duration?: number;
}

export interface GallerySourceImage {
  /** Unique source image ID (UUID) */
  id: string;
  /** Original image blob data */
  blob: Blob;
  /** Original filename */
  filename: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** MIME type (e.g., 'image/jpeg', 'image/png') */
  mimeType: string;
}

export interface GalleryProjectWithImages {
  /** Project metadata */
  project: GalleryProject;
  /** Original source image used for restoration */
  sourceImage: GallerySourceImage;
  /** Restoration result images */
  images: GalleryImage[];
}

export interface GalleryState {
  /** List of all gallery projects (metadata only) */
  projects: GalleryProject[];
  /** Whether projects are being loaded from IndexedDB */
  loading: boolean;
  /** Whether initial load has completed */
  initialized: boolean;
  /** Error message if loading failed */
  error: string | null;
}
