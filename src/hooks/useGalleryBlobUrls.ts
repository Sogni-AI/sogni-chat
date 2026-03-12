/**
 * Hook to resolve gallery image/video IDs to persistent blob URLs.
 * Uses the galleryDB to find locally-cached blobs for gallery items.
 * Returns a Map<number, string> keyed by array index for O(1) lookup.
 */

import { useState, useEffect } from 'react';
import { getImage } from '@/utils/galleryDB';

/**
 * Given an array of gallery IDs, returns a Map from index to blob URL
 * for each ID that has a locally cached blob.
 */
export function useGalleryBlobUrls(
  galleryIds?: string[],
): Map<number, string> {
  const [blobUrls, setBlobUrls] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!galleryIds || galleryIds.length === 0) {
      setBlobUrls(new Map());
      return;
    }

    let cancelled = false;
    const objectUrls: string[] = [];

    async function resolve() {
      const result = new Map<number, string>();
      await Promise.all(
        galleryIds!.map(async (gid, i) => {
          if (!gid) return;
          try {
            const img = await getImage(gid);
            if (img?.blob && !cancelled) {
              const blobUrl = URL.createObjectURL(img.blob);
              objectUrls.push(blobUrl);
              result.set(i, blobUrl);
            }
          } catch {
            // Fall back — no local blob available
          }
        }),
      );
      if (!cancelled) setBlobUrls(result);
    }

    resolve();
    return () => {
      cancelled = true;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [galleryIds]);

  return blobUrls;
}
