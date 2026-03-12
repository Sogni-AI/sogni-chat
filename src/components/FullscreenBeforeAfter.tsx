/**
 * Fullscreen before/after comparison overlay.
 * Shows a gallery of before/after pairs with navigation.
 */

import { useCallback, useEffect, useState } from 'react';

interface GalleryItem {
  before: string;
  after: string;
}

interface FullscreenBeforeAfterProps {
  items: GalleryItem[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  downloadSlug?: string;
  galleryImageIds?: string[];
}

export function FullscreenBeforeAfter({
  items,
  currentIndex,
  onClose,
  onNavigate,
  downloadSlug: _downloadSlug,
  galleryImageIds: _galleryImageIds,
}: FullscreenBeforeAfterProps) {
  const [index, setIndex] = useState(currentIndex);

  useEffect(() => setIndex(currentIndex), [currentIndex]);

  const item = items[index];

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) { setIndex(index - 1); onNavigate(index - 1); }
      if (e.key === 'ArrowRight' && index < items.length - 1) { setIndex(index + 1); onNavigate(index + 1); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onNavigate, index, items.length]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative max-w-[90vw] max-h-[90vh] flex gap-4">
        {item.before && (
          <div className="flex-1">
            <p className="text-white text-xs text-center mb-2 opacity-60">Original</p>
            <img src={item.before} alt="Original" className="max-h-[80vh] rounded-lg" />
          </div>
        )}
        <div className="flex-1">
          {item.before && <p className="text-white text-xs text-center mb-2 opacity-60">Result</p>}
          <img src={item.after} alt="Result" className="max-h-[80vh] rounded-lg" />
        </div>
      </div>

      {/* Navigation */}
      {items.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => { setIndex(i); onNavigate(i); }}
              className={`w-2 h-2 rounded-full ${i === index ? 'bg-white' : 'bg-white/40'}`}
            />
          ))}
        </div>
      )}

      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl"
        aria-label="Close"
      >
        &times;
      </button>
    </div>
  );
}
