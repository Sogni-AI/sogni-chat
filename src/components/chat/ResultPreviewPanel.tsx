/**
 * Right-side preview panel for the two-panel chat layout.
 * Shows before/after slider, result thumbnails, and action buttons.
 */
import { BeforeAfterSlider } from '@/components/BeforeAfterSlider';
import { ResultThumbnailStrip } from './ResultThumbnailStrip';
import { ResultActionBar } from './ResultActionBar';

interface ResultPreviewPanelProps {
  originalImageUrl: string | null;
  resultUrls: string[];
  activeIndex: number;
  onSelectResult: (index: number) => void;
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  /** Gallery image IDs for favorite toggle (parallel to resultUrls) */
  galleryImageIds?: string[];
}

export function ResultPreviewPanel({
  originalImageUrl,
  resultUrls,
  activeIndex,
  onSelectResult,
  onSendMessage,
  isLoading,
  galleryImageIds,
}: ResultPreviewPanelProps) {
  const hasResults = resultUrls.length > 0;
  const activeUrl = resultUrls[activeIndex] || null;

  return (
    <div
      className="result-preview-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-elevated)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {hasResults ? 'Before & After' : 'Preview'}
        </span>
      </div>

      {/* Main content area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: hasResults ? 'flex-start' : 'center',
          padding: '1rem',
          overflowY: 'auto',
          gap: '0.75rem',
        }}
      >
        {hasResults && originalImageUrl && activeUrl ? (
          <>
            {/* Before/After Slider */}
            <div style={{ width: '100%' }}>
              <BeforeAfterSlider
                beforeImage={originalImageUrl}
                afterImage={activeUrl}
                beforeLabel="Original"
                afterLabel="Restored"
              />
            </div>

            {/* Thumbnail strip */}
            <div style={{ width: '100%', paddingTop: '0.25rem' }}>
              <ResultThumbnailStrip
                urls={resultUrls}
                activeIndex={activeIndex}
                onSelect={onSelectResult}
              />
            </div>

            {/* Action bar */}
            <div style={{ width: '100%' }}>
              <ResultActionBar
                activeUrl={activeUrl}
                activeIndex={activeIndex}
                onSendMessage={onSendMessage}
                disabled={isLoading}
                galleryImageId={galleryImageIds?.[activeIndex]}
              />
            </div>
          </>
        ) : originalImageUrl ? (
          /* Empty state: show original with message */
          <div style={{ textAlign: 'center', maxWidth: '280px' }}>
            <div
              style={{
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                border: '1px solid var(--color-border)',
                marginBottom: '1rem',
              }}
            >
              <img
                src={originalImageUrl}
                alt="Original photo"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--color-text-secondary)',
                lineHeight: '1.5',
              }}
            >
              Your restored photos will appear here
            </p>
          </div>
        ) : (
          /* No image uploaded */
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '3.5rem',
                height: '3.5rem',
                borderRadius: '50%',
                background: 'rgba(var(--rgb-accent), 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 0.75rem',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--color-text-secondary)',
                lineHeight: '1.5',
              }}
            >
              Upload a photo to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
