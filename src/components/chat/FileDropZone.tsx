/**
 * Drag-and-drop zone for multi-type file uploads (image, audio, video).
 *
 * Wraps its children and shows an overlay when a file is dragged over.
 * Does not replace existing UI — it adds drag-drop capability on top.
 */

import { useCallback, useState, useRef, type CSSProperties, type DragEvent, type ReactNode } from 'react';

interface FileDropZoneProps {
  /** Called when a valid file is dropped */
  onFileDrop: (file: File) => void;
  /** Comma-separated accept string, e.g. "image/*,audio/*,video/*" */
  accept?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
}

export function FileDropZone({
  onFileDrop,
  accept,
  children,
  className,
  style,
  disabled,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  // Track nested drag enters/leaves so the overlay doesn't flicker
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Process each dropped file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (accept && !isFileAccepted(file, accept)) {
          continue;
        }
        onFileDrop(file);
      }
    },
    [disabled, accept, onFileDrop],
  );

  return (
    <div
      className={className}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ position: 'relative', ...style }}
    >
      {children}

      {isDragging && !disabled && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(var(--rgb-primary, 79, 70, 229), 0.08)',
            border: '2px dashed rgba(var(--rgb-primary, 79, 70, 229), 0.4)',
            borderRadius: 'var(--radius-lg, 12px)',
            zIndex: 50,
            pointerEvents: 'none',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--color-primary, #4F46E5)',
              fontFamily: 'var(--font-primary, Inter, sans-serif)',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ opacity: 0.7 }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
              Drop file here
            </span>
            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
              Images, audio, or video
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a file matches a comma-separated accept string.
 * Supports wildcards like "image/*" and specific MIME types.
 */
function isFileAccepted(file: File, accept: string): boolean {
  const acceptedTypes = accept.split(',').map(t => t.trim().toLowerCase());
  const fileMime = file.type.toLowerCase();
  const fileExt = file.name.toLowerCase().split('.').pop();

  for (const accepted of acceptedTypes) {
    // Wildcard (e.g., "image/*")
    if (accepted.endsWith('/*')) {
      const category = accepted.slice(0, accepted.indexOf('/'));
      if (fileMime.startsWith(category + '/')) return true;
    }
    // Exact MIME match
    else if (accepted === fileMime) {
      return true;
    }
    // Extension match (e.g., ".mp3")
    else if (accepted.startsWith('.') && fileExt === accepted.slice(1)) {
      return true;
    }
  }

  return false;
}
