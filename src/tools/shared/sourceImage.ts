/**
 * Utilities for fetching source images for tool execution.
 */

/**
 * Fetch an image URL and convert to Uint8Array with dimensions.
 * Uses an off-screen canvas to decode the image in the browser.
 */
export async function fetchImageAsUint8Array(
  url: string,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      img.src = '';
      reject(new Error('Image fetch timed out'));
    }, 30_000);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot create canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas toBlob returned null'));
            return;
          }
          blob.arrayBuffer()
            .then((buffer) => {
              resolve({
                data: new Uint8Array(buffer),
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            })
            .catch(reject);
        },
        'image/jpeg',
        0.95,
      );
    };
    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

