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
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // Downsample if either dimension exceeds SDK limit
        if (w > MAX_SDK_DIMENSION || h > MAX_SDK_DIMENSION) {
          const scale = MAX_SDK_DIMENSION / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
          console.log(`[IMAGE] imageUrlToData downsampled: ${img.naturalWidth}x${img.naturalHeight} -> ${w}x${h}`);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        // Convert to blob then to Uint8Array
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error('Failed to convert image to blob'));
            return;
          }

          try {
            const arrayBuffer = await blob.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);

            resolve({ data, width: w, height: h });
          } catch (_err) {
            reject(new Error('Failed to convert blob to Uint8Array'));
          }
        }, 'image/jpeg', 0.95);
      } catch (_err) {
        reject(new Error('Failed to process image'));
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image from URL'));
    };

    img.src = imageUrl;
  });
}
