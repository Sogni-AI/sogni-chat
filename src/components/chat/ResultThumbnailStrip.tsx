/**
 * Horizontal scrollable strip of result thumbnails.
 * Active result has a gold border highlight.
 */
import { memo, useRef, useEffect } from 'react';

interface ResultThumbnailStripProps {
  urls: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export const ResultThumbnailStrip = memo(function ResultThumbnailStrip({
  urls,
  activeIndex,
  onSelect,
}: ResultThumbnailStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the active thumbnail
  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.children[activeIndex] as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeIndex]);

  if (urls.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="result-thumbnail-strip"
      style={{
        display: 'flex',
        gap: '0.5rem',
        overflowX: 'auto',
        padding: '0.5rem 0',
        scrollbarWidth: 'thin',
      }}
    >
      {urls.map((url, index) => (
        <button
          key={`${url}-${index}`}
          onClick={() => onSelect(index)}
          style={{
            flexShrink: 0,
            width: '3.5rem',
            height: '3.5rem',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            border: index === activeIndex
              ? '2px solid var(--color-accent)'
              : '2px solid var(--color-border)',
            padding: 0,
            background: 'var(--color-bg-elevated)',
            cursor: 'pointer',
            transition: 'border-color 0.2s, transform 0.15s',
            transform: index === activeIndex ? 'scale(1.05)' : 'scale(1)',
          }}
          title={`Result #${index + 1}`}
        >
          <img
            src={url}
            alt={`Result #${index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </button>
      ))}
    </div>
  );
});
