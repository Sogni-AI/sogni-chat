/**
 * Image processing utilities
 */

/**
 * Resize a Uint8Array image for vision analysis.
 * Converts to a blob URL, resizes via canvas if needed, and returns a base64 data URI.
 */
export async function resizeUint8ArrayForVision(
  data: Uint8Array,
  mimeType = 'image/jpeg',
): Promise<string> {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await resizeImageForVision(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export async function resizeImageForVision(
  imageUrl: string,
  maxDimension: number = 1024,
  quality: number = 0.92,
): Promise<string> {
  // Check dimensions first to decide if resize is actually needed
  const { img, width, height } = await loadImage(imageUrl);
  const needsResize = width > maxDimension || height > maxDimension;

  if (!needsResize) {
    // Already within limits — convert to data URI without expensive canvas re-encode
    return blobUrlToDataUri(imageUrl);
  }

  const scale = maxDimension / Math.max(width, height);
  const tw = Math.round(width * scale);
  const th = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create canvas context');
  ctx.drawImage(img, 0, 0, tw, th);

  console.log(`[IMAGE] Resized for vision: ${width}x${height} -> ${tw}x${th}`);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Load an image element and return it with its dimensions */
function loadImage(url: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/** Convert a blob/http URL to a data URI via fetch (no canvas re-encode) */
async function blobUrlToDataUri(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to convert blob to data URI'));
    reader.readAsDataURL(blob);
  });
}

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heif', 'image/heic', 'image/avif'];

  // Extension-based fallback (some browsers report empty MIME for HEIF/HEIC)
  const ext = file.name?.toLowerCase().split('.').pop();
  const hasValidExtension = ['jpg', 'jpeg', 'png', 'webp', 'heif', 'heic', 'avif'].includes(ext || '');
  const hasValidType = allowedTypes.includes(file.type);

  if (!hasValidType && !hasValidExtension) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a JPG, PNG, WEBP, HEIF, or AVIF image.'
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File is too large. Maximum size is ${(maxSize / 1024 / 1024).toFixed(0)}MB.`
    };
  }

  return { valid: true };
}

export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export function createImageUrl(file: File): string {
  return URL.createObjectURL(file);
}

export function revokeImageUrl(url: string): void {
  URL.revokeObjectURL(url);
}

/** Maximum pixel dimension accepted by the Sogni SDK */
const MAX_SDK_DIMENSION = 2048;

/**
 * Downsample an image so neither dimension exceeds MAX_SDK_DIMENSION.
 * Uses iterative half-stepping for high-quality resampling (Lanczos-like)
 * when the source is more than 2x the target, then a final resize.
 * Returns the original file unchanged if already within limits.
 */
export async function downsampleIfOversized(
  file: File,
  width: number,
  height: number,
  maxDim: number = MAX_SDK_DIMENSION,
): Promise<{ file: File; width: number; height: number }> {
  if (width <= maxDim && height <= maxDim) {
    return { file, width, height };
  }

  const scale = maxDim / Math.max(width, height);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  // Load source image
  const bitmap = await createImageBitmap(file);

  // Step-down for quality: iteratively halve until within 2x of target
  let srcW = bitmap.width;
  let srcH = bitmap.height;
  let currentSource: ImageBitmap | HTMLCanvasElement = bitmap;

  while (srcW / 2 > targetW && srcH / 2 > targetH) {
    const halfW = Math.round(srcW / 2);
    const halfH = Math.round(srcH / 2);
    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = halfW;
    stepCanvas.height = halfH;
    const stepCtx = stepCanvas.getContext('2d')!;
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(currentSource, 0, 0, halfW, halfH);
    if (currentSource instanceof ImageBitmap) currentSource.close();
    currentSource = stepCanvas;
    srcW = halfW;
    srcH = halfH;
  }

  // Final resize to exact target
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(currentSource, 0, 0, targetW, targetH);
  if (currentSource instanceof ImageBitmap) currentSource.close();

  // Determine output format — keep PNG for PNGs, otherwise JPEG
  const isPng = file.type === 'image/png';
  const mimeType = isPng ? 'image/png' : 'image/jpeg';
  const ext = isPng ? 'png' : 'jpg';
  const quality = isPng ? undefined : 0.92;

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), mimeType, quality),
  );

  const baseName = file.name.replace(/\.[^.]+$/, '');
  const resized = new File([blob], `${baseName}.${ext}`, { type: mimeType });
  console.log(`[IMAGE] Downsampled: ${width}x${height} -> ${targetW}x${targetH} (${(blob.size / 1024).toFixed(0)}KB)`);

  return { file: resized, width: targetW, height: targetH };
}

export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

/**
 * MIME types and extensions that need server-side transcoding to JPEG.
 * WebP: browsers can display it, but the Sogni SDK requires JPEG/PNG input
 * HEIF/HEIC: most browsers cannot display or decode these formats
 */
const TRANSCODE_TYPES = new Set(['image/webp', 'image/heif', 'image/heic', 'image/avif']);
const TRANSCODE_EXTENSIONS = new Set(['webp', 'heif', 'heic', 'avif']);

export function needsTranscoding(file: File): boolean {
  if (TRANSCODE_TYPES.has(file.type)) return true;
  const ext = file.name?.toLowerCase().split('.').pop();
  return TRANSCODE_EXTENSIONS.has(ext || '');
}

/**
 * Transcode WebP/HEIF/HEIC files to JPEG via the server.
 * JPEG and PNG files pass through unchanged.
 * Returns { file, width, height } -- the file is a new JPEG File if transcoded.
 */
export async function transcodeIfNeeded(file: File): Promise<{ file: File; width: number; height: number }> {
  if (!needsTranscoding(file)) {
    const dimensions = await getImageDimensions(file);
    return { file, width: dimensions.width, height: dimensions.height };
  }

  console.log('[IMAGE] Transcoding', file.name, file.type, 'to JPEG via server');

  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch('/api/transcode', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Transcode failed' }));
    throw new Error(err.error || 'Failed to transcode image');
  }

  const width = parseInt(response.headers.get('X-Image-Width') || '0', 10);
  const height = parseInt(response.headers.get('X-Image-Height') || '0', 10);

  if (!width || !height) {
    throw new Error('Server returned invalid image dimensions');
  }

  const blob = await response.blob();

  // Create a new File with .jpg extension
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const transcodedFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });

  console.log('[IMAGE] Transcoded:', `${width}x${height}`, `${(blob.size / 1024).toFixed(0)}KB`);

  return { file: transcodedFile, width, height };
}
