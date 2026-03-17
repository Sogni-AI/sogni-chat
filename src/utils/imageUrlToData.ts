/**
 * Utility to fetch an image URL and convert to Uint8Array with dimensions
 */

/** Maximum pixel dimension accepted by the Sogni SDK */
const MAX_SDK_DIMENSION = 2048;

export interface ImageData {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Fetch an image URL and convert it to Uint8Array with dimensions.
 * Automatically downsamples if either dimension exceeds 2048px.
 * Works with blob URLs, data URLs, and remote URLs.
 */
export async function imageUrlToData(imageUrl: string): Promise<ImageData> {
  // Load image to get dimensions
  const { img, width, height } = await loadImageElement(imageUrl);
  const needsDownsample = width > MAX_SDK_DIMENSION || height > MAX_SDK_DIMENSION;

  if (!needsDownsample) {
    // Already within SDK limits — fetch raw bytes directly, no canvas re-encode
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return { data: new Uint8Array(arrayBuffer), width, height };
  }

  const scale = MAX_SDK_DIMENSION / Math.max(width, height);
  const tw = Math.round(width * scale);
  const th = Math.round(height * scale);
  console.log(`[IMAGE] imageUrlToData downsampled: ${width}x${height} -> ${tw}x${th}`);

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tw, th);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) { reject(new Error('Failed to convert image to blob')); return; }
        try {
          const arrayBuffer = await blob.arrayBuffer();
          resolve({ data: new Uint8Array(arrayBuffer), width: tw, height: th });
        } catch { reject(new Error('Failed to convert blob to Uint8Array')); }
      },
      'image/jpeg',
      0.95,
    );
  });
}

function loadImageElement(url: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image from URL'));
    img.src = url;
  });
}
