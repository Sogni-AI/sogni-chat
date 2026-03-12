/**
 * Before/after image comparison slider.
 * Drag the divider to reveal the before (left) vs. after (right) image.
 */

import { useRef, useState, useCallback, useEffect } from 'react';

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  fullscreen?: boolean;
  className?: string;
}

export function BeforeAfterSlider({
  beforeImage,
  afterImage,
  beforeLabel = 'Before',
  afterLabel = 'After',
  fullscreen: _fullscreen,
  className = '',
}: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPosition((x / rect.width) * 100);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      updatePosition(clientX);
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDragging, updatePosition]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden select-none ${className}`}>
      {/* After (full) */}
      <img src={afterImage} alt={afterLabel} className="w-full h-full object-contain" />
      {/* Before (clipped) */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${position}%` }}>
        <img
          src={beforeImage}
          alt={beforeLabel}
          className="w-full h-full object-contain"
          style={{ width: containerRef.current?.offsetWidth }}
        />
      </div>
      {/* Labels */}
      <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/50 rounded text-white text-xs">
        {beforeLabel}
      </div>
      <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/50 rounded text-white text-xs">
        {afterLabel}
      </div>
      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-white cursor-col-resize shadow-lg"
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        onMouseDown={() => setIsDragging(true)}
        onTouchStart={() => setIsDragging(true)}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
          <span className="text-gray-600 text-sm">&harr;</span>
        </div>
      </div>
    </div>
  );
}
