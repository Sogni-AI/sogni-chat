/**
 * Mobile Download Utilities
 * Provides mobile-optimized download functionality using Web Share API
 * for saving photos AND videos to camera roll on iOS and Android.
 */

/**
 * Detect if device is mobile
 */
export const isMobile = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * Detect if device is iOS
 */
export const isIOS = (): boolean => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
};

/**
 * Detect if device is Android
 */
export const isAndroid = (): boolean => {
  return /Android/i.test(navigator.userAgent);
};

/** Infer MIME type from filename */
function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * Mobile-aware download for both images and videos.
 * Tries Web Share API first (native save dialog on iOS/Android),
 * then falls back to anchor-based download.
 *
 * @param url - The file URL (blob: or remote)
 * @param filename - The download filename
 * @param existingBlob - Optional pre-fetched Blob to avoid re-fetching
 * @returns true if handled, false if caller should fall back
 */
export const downloadFileMobile = async (
  url: string,
  filename: string,
  existingBlob?: Blob,
): Promise<boolean> => {
  try {
    if (!isMobile()) return false;

    // Method 1: Web Share API (best UX on iOS and Android)
    if (navigator.share && navigator.canShare) {
      try {
        const blob: Blob = existingBlob ?? await fetch(url).then(r => r.blob());
        const mime = blob.type || mimeFromFilename(filename);
        const file = new File([blob], filename, { type: mime });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Save',
          });
          return true;
        }
      } catch (shareError: any) {
        // User cancelled -- that's fine, don't fall through
        if (
          shareError.name === 'AbortError' ||
          shareError.name === 'NotAllowedError' ||
          shareError.message?.includes('abort') ||
          shareError.message?.includes('cancel') ||
          shareError.message?.includes('dismissed')
        ) {
          console.log('[MOBILE DOWNLOAD] User cancelled share dialog');
          return true;
        }
        console.log('[MOBILE DOWNLOAD] Web Share failed, trying fallback:', shareError.message);
      }
    }

    // Method 2: Anchor-based download with proper MIME type
    try {
      const blob: Blob = existingBlob ?? await fetch(url).then(r => r.blob());
      const mime = blob.type || mimeFromFilename(filename);
      const typedBlob = new Blob([blob], { type: mime });
      const blobUrl = URL.createObjectURL(typedBlob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.setAttribute('type', mime);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      return true;
    } catch (dlError) {
      console.error('[MOBILE DOWNLOAD] Anchor download failed:', dlError);
    }

    // Method 3: Open in new tab as last resort
    window.open(url, '_blank');
    return true;

  } catch (error) {
    console.error('[MOBILE DOWNLOAD] All methods failed:', error);
    return false;
  }
};

/**
 * @deprecated Use downloadFileMobile instead
 */
export const downloadImageMobile = downloadFileMobile;

export default {
  downloadFileMobile,
  downloadImageMobile: downloadFileMobile,
  isAndroid,
  isIOS,
  isMobile,
};
