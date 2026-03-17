/**
 * Gallery Service - Auto-Save Logic
 *
 * Saves completed restoration results to the local gallery IndexedDB.
 * Called from RestorePage when a restoration job completes, this service
 * handles downloading result images, extracting dimensions, and persisting
 * everything as a GalleryProject with associated GalleryImage records.
 */

import {
  saveSourceImage,
  saveProject,
  saveImage,
  getProject,
  getProjectImages,
} from '@/utils/galleryDB';
import type { GalleryProject, GalleryImage, GallerySourceImage } from '@/types/gallery';
import { getVideoModelConfig } from '@/constants/videoSettings';
import { AUDIO_MODELS } from '@/constants/audioSettings';

// ============================================================================
// Types
// ============================================================================

export interface SaveRestorationParams {
  sourceImageBlob: Blob;
  sourceFilename: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceMimeType: string;
  resultUrls: string[];
  model: string;
  prompt: string;
  sdkJobIds?: string[];
}

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Extract width and height from an image blob by loading it into an Image element.
 */
async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for dimension extraction'));
    };

    img.src = url;
  });
}

/**
 * Download an image from a URL and return the blob with dimensions.
 *
 * Strategy:
 * 1. Try fetch() first - get blob, then extract dimensions via Image element
 * 2. If fetch fails (e.g. CORS), fall back to Image element + canvas capture
 */
async function downloadImageBlob(
  url: string
): Promise<{ blob: Blob; width: number; height: number; mimeType: string }> {
  // Strategy 1: fetch the image directly
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const mimeType = blob.type || 'image/jpeg';
    const { width, height } = await getImageDimensions(blob);

    return { blob, width, height, mimeType };
  } catch (fetchError) {
    console.warn('[GALLERY SERVICE] Fetch failed, falling back to canvas capture:', fetchError);
  }

  // Strategy 2: Load via Image element and capture with canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = img;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas 2D context'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob returned null'));
              return;
            }
            resolve({ blob, width, height, mimeType: 'image/jpeg' });
          },
          'image/jpeg',
          0.95
        );
      } catch (canvasError) {
        reject(new Error(`Canvas capture failed: ${canvasError}`));
      }
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image from URL: ${url}`));
    };

    img.src = url;
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Save a completed restoration to the gallery.
 *
 * 1. Generates project and source image IDs
 * 2. Saves the source image to the sourceImages store
 * 3. Creates a project record with an auto-generated name
 * 4. Downloads all result images in parallel
 * 5. Saves each result as a GalleryImage record
 * 6. If an individual image download fails, logs the error but continues
 *
 * @returns The generated projectId and gallery image IDs (ordered by index)
 */
export async function saveRestorationToGallery(
  params: SaveRestorationParams
): Promise<{ projectId: string; galleryImageIds: string[] }> {
  const {
    sourceImageBlob,
    sourceFilename,
    sourceWidth,
    sourceHeight,
    sourceMimeType,
    resultUrls,
    model,
    prompt,
    sdkJobIds,
  } = params;

  const projectId = crypto.randomUUID();
  const sourceImageId = crypto.randomUUID();
  const now = Date.now();

  // 1. Save source image
  const sourceImage: GallerySourceImage = {
    id: sourceImageId,
    blob: sourceImageBlob,
    filename: sourceFilename,
    width: sourceWidth,
    height: sourceHeight,
    mimeType: sourceMimeType,
  };

  await saveSourceImage(sourceImage);
  console.log('[GALLERY SERVICE] Source image saved:', sourceImageId);

  // 2. Create project record
  const dateStr = new Date(now).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const name = `Creation - ${dateStr}`;

  const project: GalleryProject = {
    id: projectId,
    name,
    sourceImageId,
    model,
    prompt,
    numberOfResults: resultUrls.length,
    createdAt: now,
    updatedAt: now,
  };

  await saveProject(project);
  console.log('[GALLERY SERVICE] Project saved:', projectId, name);

  // 3. Download all result images in parallel
  const downloadResults = await Promise.all(
    resultUrls.map(async (url, index) => {
      try {
        const { blob, width, height, mimeType } = await downloadImageBlob(url);

        const galleryImageId = crypto.randomUUID();
        const galleryImage: GalleryImage = {
          id: galleryImageId,
          projectId,
          blob,
          width,
          height,
          mimeType,
          index,
          isFavorite: false,
          createdAt: now,
          sdkJobId: sdkJobIds?.[index],
        };

        await saveImage(galleryImage);
        console.log(`[GALLERY SERVICE] Result image ${index + 1}/${resultUrls.length} saved`);

        return { success: true as const, index, galleryImageId };
      } catch (error) {
        console.error(
          `[GALLERY SERVICE] Failed to download/save result image ${index + 1}:`,
          error
        );
        return { success: false as const, index, error };
      }
    })
  );

  const savedCount = downloadResults.filter((r) => r.success).length;
  console.log(
    `[GALLERY SERVICE] Restoration saved: ${savedCount}/${resultUrls.length} images, project ${projectId}`
  );

  // Collect gallery image IDs in order (undefined for failed downloads → filter to strings)
  const galleryImageIds = downloadResults
    .sort((a, b) => a.index - b.index)
    .filter((r): r is typeof r & { success: true; galleryImageId: string } => r.success && 'galleryImageId' in r)
    .map((r) => r.galleryImageId);

  return { projectId, galleryImageIds };
}

// ============================================================================
// Video Save
// ============================================================================

export interface SaveVideoParams {
  /** Video URL to download */
  videoUrl: string;
  /** Existing project ID to attach to (creates new project if omitted) */
  projectId?: string;
  /** Source image data (needed if creating a new project) */
  sourceImageBlob?: Blob;
  sourceWidth?: number;
  sourceHeight?: number;
  /** Prompt used for video generation */
  prompt?: string;
  /** Video duration in seconds */
  duration?: number;
}

/**
 * Save a generated video to the gallery.
 *
 * Downloads the video blob from the URL and saves it as a GalleryImage
 * with mediaType 'video'. If a projectId is provided, attaches to that
 * existing project. Otherwise creates a new project.
 *
 * @returns The projectId and gallery image ID the video was saved as
 */
export async function saveVideoToGallery(
  params: SaveVideoParams
): Promise<{ projectId: string; galleryImageId: string }> {
  const {
    videoUrl,
    projectId: existingProjectId,
    sourceImageBlob,
    sourceWidth,
    sourceHeight,
    prompt,
    duration,
  } = params;

  const now = Date.now();

  // Download video blob
  let videoBlob: Blob;
  try {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    videoBlob = await response.blob();
    console.log(`[GALLERY SERVICE] Video downloaded: ${(videoBlob.size / 1024 / 1024).toFixed(1)}MB`);
  } catch (error) {
    console.error('[GALLERY SERVICE] Failed to download video:', error);
    throw error;
  }

  // Determine project ID — use existing or create new
  let projectId = existingProjectId;

  if (!projectId) {
    projectId = crypto.randomUUID();
    const sourceImageId = crypto.randomUUID();

    // Save source image if provided
    if (sourceImageBlob) {
      await saveSourceImage({
        id: sourceImageId,
        blob: sourceImageBlob,
        filename: `source-${Date.now()}.jpg`,
        width: sourceWidth || 0,
        height: sourceHeight || 0,
        mimeType: 'image/jpeg',
      });
    }

    const dateStr = new Date(now).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    await saveProject({
      id: projectId,
      name: `Video - ${dateStr}`,
      sourceImageId,
      model: getVideoModelConfig().model,
      prompt: prompt || 'Video animation',
      numberOfResults: 1,
      createdAt: now,
      updatedAt: now,
    });
    console.log('[GALLERY SERVICE] New video project created:', projectId);
  } else {
    // Update existing project's updatedAt and increment numberOfResults
    const existingProject = await getProject(projectId);
    if (existingProject) {
      existingProject.updatedAt = now;
      existingProject.numberOfResults += 1;
      await saveProject(existingProject);
    }
  }

  // Determine next index for this project
  const existingImages = await getProjectImages(projectId);
  const nextIndex = existingImages.length;

  // Save video as GalleryImage with mediaType 'video'
  const galleryImageId = crypto.randomUUID();
  const galleryImage: GalleryImage = {
    id: galleryImageId,
    projectId,
    blob: videoBlob,
    width: sourceWidth || 0,
    height: sourceHeight || 0,
    mimeType: videoBlob.type || 'video/mp4',
    index: nextIndex,
    isFavorite: false,
    createdAt: now,
    mediaType: 'video',
    duration: duration || 5,
  };

  await saveImage(galleryImage);
  console.log(`[GALLERY SERVICE] Video saved to gallery, project ${projectId}`);

  return { projectId, galleryImageId };
}

// ============================================================================
// Audio Save
// ============================================================================

export interface SaveAudioParams {
  /** Audio URL to download */
  audioUrl: string;
  /** Prompt used for music generation */
  prompt?: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Model key used (e.g. 'turbo', 'sft') */
  modelKey?: string;
}

/**
 * Save a generated audio track to the gallery.
 *
 * Downloads the audio blob from the URL and saves it as a GalleryImage
 * with mediaType 'audio'. Creates a new project for each track.
 *
 * @returns The projectId and gallery image ID
 */
export async function saveAudioToGallery(
  params: SaveAudioParams
): Promise<{ projectId: string; galleryImageId: string }> {
  const { audioUrl, prompt, duration, modelKey } = params;
  const now = Date.now();

  // Download audio blob
  let audioBlob: Blob;
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }
    audioBlob = await response.blob();
    console.log(`[GALLERY SERVICE] Audio downloaded: ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB`);
  } catch (error) {
    console.error('[GALLERY SERVICE] Failed to download audio:', error);
    throw error;
  }

  const projectId = crypto.randomUUID();
  const sourceImageId = crypto.randomUUID();

  // Create a minimal placeholder source image for the project
  // (projects require a sourceImageId; audio has no visual source)
  await saveSourceImage({
    id: sourceImageId,
    blob: new Blob([], { type: 'audio/mpeg' }),
    filename: `audio-source-${Date.now()}.mp3`,
    width: 0,
    height: 0,
    mimeType: 'audio/mpeg',
  });

  const dateStr = new Date(now).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const modelName = modelKey && AUDIO_MODELS[modelKey as keyof typeof AUDIO_MODELS]
    ? AUDIO_MODELS[modelKey as keyof typeof AUDIO_MODELS].name
    : 'Music';

  await saveProject({
    id: projectId,
    name: `${modelName} - ${dateStr}`,
    sourceImageId,
    model: modelName,
    prompt: prompt || 'Music generation',
    numberOfResults: 1,
    createdAt: now,
    updatedAt: now,
  });
  console.log('[GALLERY SERVICE] New audio project created:', projectId);

  // Save audio as GalleryImage with mediaType 'audio'
  const galleryImageId = crypto.randomUUID();
  const galleryImage: GalleryImage = {
    id: galleryImageId,
    projectId,
    blob: audioBlob,
    width: 0,
    height: 0,
    mimeType: audioBlob.type || 'audio/mpeg',
    index: 0,
    isFavorite: false,
    createdAt: now,
    mediaType: 'audio',
    duration: duration || 30,
  };

  await saveImage(galleryImage);
  console.log(`[GALLERY SERVICE] Audio saved to gallery, project ${projectId}`);

  return { projectId, galleryImageId };
}
