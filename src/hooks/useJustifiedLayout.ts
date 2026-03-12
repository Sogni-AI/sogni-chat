/**
 * useJustifiedLayout - Computes a justified (Flickr/Google Photos style) image grid.
 *
 * Each row fills the full container width. Images are scaled to the same height
 * within a row. Different rows can have different heights. Items flow
 * left-to-right, top-to-bottom.
 *
 * Core math: rowHeight = availableWidth / sumOfAspectRatios
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface JustifiedItem {
  width: number;
  height: number;
}

export interface LayoutBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface JustifiedLayoutResult {
  boxes: LayoutBox[];
  containerHeight: number;
}

// ============================================================================
// Layout algorithm
// ============================================================================

export function computeJustifiedLayout(
  items: JustifiedItem[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): JustifiedLayoutResult {
  if (items.length === 0 || containerWidth <= 0) {
    return { boxes: [], containerHeight: 0 };
  }

  const boxes: LayoutBox[] = [];
  let rowStart = 0;
  let rowTop = 0;

  for (let i = 0; i < items.length; i++) {
    // Sum aspect ratios for items in the current row (rowStart..i)
    let sumAR = 0;
    for (let j = rowStart; j <= i; j++) {
      sumAR += (items[j].width || 1) / (items[j].height || 1);
    }

    const n = i - rowStart + 1;
    const availableWidth = containerWidth - (n - 1) * gap;
    const rowHeight = availableWidth / sumAR;
    const isLastItem = i === items.length - 1;

    // Seal the row when height drops to/below target, or on the last item
    if (rowHeight <= targetRowHeight || isLastItem) {
      // For incomplete last rows, cap height at target (left-align, don't stretch)
      const isIncompleteLastRow = isLastItem && rowHeight > targetRowHeight;
      const finalHeight = isIncompleteLastRow ? targetRowHeight : rowHeight;

      let left = 0;
      for (let j = rowStart; j <= i; j++) {
        const ar = (items[j].width || 1) / (items[j].height || 1);
        const w = ar * finalHeight;
        boxes.push({
          top: Math.round(rowTop),
          left: Math.round(left),
          width: Math.round(w),
          height: Math.round(finalHeight),
        });
        left += w + gap;
      }

      // For complete rows, adjust last item width to fill container exactly
      if (!isIncompleteLastRow && n > 0) {
        const lastBox = boxes[boxes.length - 1];
        lastBox.width = containerWidth - lastBox.left;
      }

      rowTop += Math.round(finalHeight) + gap;
      rowStart = i + 1;
    }
  }

  return {
    boxes,
    containerHeight: rowTop > 0 ? rowTop - gap : 0,
  };
}

// ============================================================================
// Hook
// ============================================================================

interface UseJustifiedLayoutOptions {
  targetRowHeight?: number;
  gap?: number;
}

export function useJustifiedLayout(
  items: JustifiedItem[],
  options: UseJustifiedLayoutOptions = {},
) {
  const { targetRowHeight = 220, gap = 8 } = options;
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // Callback ref so the observer re-attaches when the element mounts/unmounts
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  useEffect(() => {
    if (!containerEl) {
      setContainerWidth(0);
      return;
    }

    setContainerWidth(containerEl.getBoundingClientRect().width);

    let rafId: number;
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0) {
            setContainerWidth(entry.contentRect.width);
          }
        }
      });
    });

    observer.observe(containerEl);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [containerEl]);

  const layout = useMemo(() => {
    if (containerWidth === 0 || items.length === 0) {
      return { boxes: [] as LayoutBox[], containerHeight: 0 };
    }
    return computeJustifiedLayout(items, containerWidth, targetRowHeight, gap);
  }, [containerWidth, items, targetRowHeight, gap]);

  return { containerRef, layout };
}
