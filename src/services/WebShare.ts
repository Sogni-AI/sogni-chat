/**
 * WebShare.ts
 * Service for handling Web Share API functionality
 */
import { trackShare } from '@/services/analyticsService';

/**
 * Pre-fetch an image and return a File ready for sharing.
 * Call this ahead of time so the blob is ready when the user clicks Share.
 */
export const prefetchShareFile = async (
  imageUrl: string,
  filename: string = 'restored-photo.jpg'
): Promise<File | null> => {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
};

export const shareViaWebShare = async (
  imageUrl: string,
  _filename: string,
  title: string = 'My AI Creation',
  text: string = 'Check out what I made with Sogni AI!',
  prefetchedFile?: File | null
): Promise<void> => {
  if (!navigator.share) {
    throw new Error('Native sharing is not supported on this browser. Please use the download button instead.');
  }

  try {
    // Use pre-fetched file if available (preserves user gesture — no async fetch at share time)
    if (prefetchedFile && navigator.canShare?.({ files: [prefetchedFile] })) {
      await navigator.share({ files: [prefetchedFile], title, text });
    } else {
      await navigator.share({ title, text, url: imageUrl });
    }
    trackShare('web_share_api');
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    console.error('[WebShare] Share failed:', err);
    throw err;
  }
};

/**
 * Check if Web Share API is supported on this device
 * @returns boolean
 */
export const isWebShareSupported = (): boolean => {
  return typeof navigator !== 'undefined' &&
         navigator.share !== undefined &&
         navigator.canShare !== undefined;
};

/**
 * Share to Twitter (opens Twitter in new window)
 */
export const shareToTwitter = (imageUrl: string, text: string = 'Check out my restored photo!'): void => {
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(imageUrl)}`;
  window.open(twitterUrl, '_blank', 'noopener,noreferrer');
  trackShare('twitter');
};
