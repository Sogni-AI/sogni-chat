/**
 * Utilities for fetching source media (images, audio) for tool execution.
 */

/**
 * Fetch an audio URL and return the raw bytes + detected MIME type.
 * Unlike the image variant this does a straightforward binary fetch
 * (no canvas needed).
 */
export async function fetchAudioAsUint8Array(
  url: string,
): Promise<{ data: Uint8Array; mimeType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Audio fetch failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('Audio fetch returned empty data');
    }
    return { data: new Uint8Array(buffer), mimeType: contentType };
  } finally {
    clearTimeout(timeout);
  }
}

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

