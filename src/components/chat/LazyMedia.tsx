/**
 * LazyMedia — Defers rendering of media content until it scrolls near the viewport.
 * Used to avoid loading all images/videos/audio at once when restoring a chat session.
 * Shows a lightweight placeholder until the content becomes visible.
 * Pass enabled={false} to render children immediately (pass-through mode).
 */
import { useEffect, useRef, useState } from 'react';

interface LazyMediaProps {
  children: React.ReactNode;
  /** When false, renders children immediately without lazy loading */
  enabled?: boolean;
  /** Approximate height for the placeholder (prevents layout shift) */
  placeholderHeight?: number | string;
  /** IntersectionObserver rootMargin — how far ahead to start loading (default: '200px') */
  rootMargin?: string;
}

export function LazyMedia({ children, enabled = true, placeholderHeight = 200, rootMargin = '200px' }: LazyMediaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(!enabled);

  useEffect(() => {
    if (!enabled || isVisible) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, enabled, isVisible]);

  if (isVisible) {
    return <>{children}</>;
  }

  return (
    <div
      ref={ref}
      style={{
        minHeight: placeholderHeight,
        borderRadius: 'var(--radius-md)',
        background: 'rgba(var(--rgb-primary), 0.04)',
      }}
    />
  );
}
