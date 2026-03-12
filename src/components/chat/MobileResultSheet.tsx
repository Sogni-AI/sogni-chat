/**
 * Mobile slide-up sheet for viewing restoration results.
 * Contains the same content as the desktop ResultPreviewPanel.
 */
import { useEffect, useCallback } from 'react';
import { BeforeAfterSlider } from '@/components/BeforeAfterSlider';
import { ResultThumbnailStrip } from './ResultThumbnailStrip';
import { ResultActionBar } from './ResultActionBar';

interface MobileResultSheetProps {
  isOpen: boolean;
  onClose: () => void;
  originalImageUrl: string;
  resultUrls: string[];
  activeIndex: number;
  onSelectResult: (index: number) => void;
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export function MobileResultSheet({
  isOpen,
  onClose,
  originalImageUrl,
  resultUrls,
  activeIndex,
  onSelectResult,
  onSendMessage,
  isLoading,
}: MobileResultSheetProps) {
  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  const activeUrl = resultUrls[activeIndex] || null;

  return (
    <div
      className="mobile-result-sheet-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.5)',
        animation: 'mobileSheetBackdropIn 0.2s ease-out',
      }}
    >
      <div
        className="mobile-result-sheet"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          maxHeight: '85vh',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'mobileSheetSlideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {/* Handle bar */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.75rem 0 0.25rem' }}>
          <div
            style={{
              width: '2.5rem',
              height: '0.25rem',
              borderRadius: '999px',
              background: 'var(--color-border)',
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.5rem 1rem 0.75rem',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span
            style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-display)',
            }}
          >
            Results
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '0.25rem 0.625rem',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              background: 'rgba(var(--rgb-primary), 0.05)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {/* Before/After Slider */}
          {activeUrl && (
            <div style={{ marginBottom: '1rem' }}>
              <BeforeAfterSlider
                beforeImage={originalImageUrl}
                afterImage={activeUrl}
                beforeLabel="Original"
                afterLabel="Restored"
                fullscreen={false}
              />
            </div>
          )}

          {/* Thumbnail strip */}
          <ResultThumbnailStrip
            urls={resultUrls}
            activeIndex={activeIndex}
            onSelect={onSelectResult}
          />

          {/* Action bar */}
          <div style={{ marginTop: '0.75rem' }}>
            <ResultActionBar
              activeUrl={activeUrl}
              activeIndex={activeIndex}
              onSendMessage={onSendMessage}
              disabled={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
