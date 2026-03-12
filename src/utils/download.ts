/**
 * Download utilities
 * Provides mobile-aware download for images and videos (URLs and Blobs).
 * On iOS/Android, routes through Web Share API for native save-to-camera-roll.
 */

import { downloadFileMobile, isMobile } from './mobileDownload';

/**
 * Download a file from a URL with mobile-aware share sheet support.
 */
export async function downloadImage(url: string, filename: string): Promise<void> {
  if (isMobile()) {
    const success = await downloadFileMobile(url, filename);
    if (success) return;
  }
  await _anchorDownload(url, filename);
}

/**
 * Download a Blob with mobile-aware share sheet support.
 * Use this from gallery/carousel components that already have the blob in memory.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isMobile()) {
    const url = URL.createObjectURL(blob);
    try {
      const success = await downloadFileMobile(url, filename, blob);
      if (success) return;
    } finally {
      // Blob URL will be cleaned up below if we fall through
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Internal: anchor-based download for desktop */
async function _anchorDownload(url: string, filename: string): Promise<void> {
  // For blob URLs, download directly
  if (url.startsWith('blob:')) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
