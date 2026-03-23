/**
 * Action buttons for the active result in the preview panel.
 * Refine, Apply Style, Favorite, and Download with quick preset chips.
 */
import { useState, useCallback, useEffect } from 'react';
import { downloadImage } from '@/utils/download';
import { buildDownloadFilename, type DownloadMetadata } from '@/utils/downloadFilename';
import { toggleFavorite as dbToggleFavorite, getImage } from '@/utils/galleryDB';

interface ResultActionBarProps {
  activeUrl: string | null;
  activeIndex: number;
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  /** Gallery image ID for the active result (enables favorite toggle) */
  galleryImageId?: string;
  /** Descriptive slug for download filenames (e.g. slugified session title) */
  downloadSlug?: string;
  /** Media type for correct file extension and prefix */
  mediaType?: 'image' | 'video' | 'audio';
  /** Generation metadata for rich download filenames */
  downloadMetadata?: DownloadMetadata;
}

const REFINE_PRESETS = [
  { label: 'Make it sharper', message: 'Can you make the details and faces sharper?' },
  { label: 'Warmer colors', message: 'Make the colors warmer and more vibrant.' },
  { label: 'Cooler tones', message: 'Give this a cooler, more neutral tone.' },
  { label: 'More contrast', message: 'Increase the contrast for more depth.' },
  { label: 'Softer look', message: 'Give this a softer, more gentle look.' },
];

const STYLE_PRESETS = [
  { label: 'Norman Rockwell', message: 'Apply a Norman Rockwell style to this result.' },
  { label: 'Vintage', message: 'Give this a warm vintage film look.' },
  { label: 'Oil painting', message: 'Transform this into an oil painting style.' },
  { label: 'Pencil sketch', message: 'Apply a detailed pencil sketch style.' },
];

export function ResultActionBar({
  activeUrl,
  activeIndex,
  onSendMessage,
  disabled,
  galleryImageId,
  downloadSlug,
  mediaType,
  downloadMetadata,
}: ResultActionBarProps) {
  const [expandedAction, setExpandedAction] = useState<'refine' | 'style' | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);

  // Check favorite status when gallery ID changes
  useEffect(() => {
    if (!galleryImageId) { setIsFavorite(false); return; }
    getImage(galleryImageId).then(img => {
      setIsFavorite(img?.isFavorite ?? false);
    }).catch(() => setIsFavorite(false));
  }, [galleryImageId]);

  const handleToggleFavorite = useCallback(async () => {
    if (!galleryImageId) return;
    const prev = isFavorite;
    setIsFavorite(!prev);
    try {
      const newVal = await dbToggleFavorite(galleryImageId);
      setIsFavorite(newVal);
    } catch {
      setIsFavorite(prev);
    }
  }, [galleryImageId, isFavorite]);

  const handleDownload = useCallback(() => {
    if (!activeUrl) return;
    const filenameType = mediaType === 'video' ? 'video' as const : mediaType === 'audio' ? 'audio' as const : 'restored' as const;
    const filename = buildDownloadFilename(downloadSlug, activeIndex + 1, filenameType, downloadMetadata);
    downloadImage(activeUrl, filename).catch((err) =>
      console.error('[RESULT ACTION] Download failed:', err),
    );
  }, [activeUrl, activeIndex, downloadSlug, mediaType, downloadMetadata]);

  const handlePresetClick = useCallback(
    (message: string) => {
      onSendMessage(message);
      setExpandedAction(null);
    },
    [onSendMessage],
  );

  const toggleAction = useCallback((action: 'refine' | 'style') => {
    setExpandedAction((prev) => (prev === action ? null : action));
  }, []);

  const presets = expandedAction === 'refine' ? REFINE_PRESETS : expandedAction === 'style' ? STYLE_PRESETS : [];

  return (
    <div className="result-action-bar" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Main action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => toggleAction('refine')}
          disabled={disabled}
          className="result-action-btn"
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            color: expandedAction === 'refine' ? '#0a0a0a' : 'var(--color-text-primary)',
            background: expandedAction === 'refine' ? '#ffffff' : 'rgba(var(--rgb-primary), 0.06)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          Refine
        </button>
        <button
          onClick={() => toggleAction('style')}
          disabled={disabled}
          className="result-action-btn"
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            color: expandedAction === 'style' ? '#0a0a0a' : 'var(--color-text-primary)',
            background: expandedAction === 'style' ? '#ffffff' : 'rgba(var(--rgb-primary), 0.06)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          Apply Style
        </button>
        {galleryImageId && (
          <button
            onClick={handleToggleFavorite}
            disabled={disabled}
            className="result-action-btn"
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            style={{
              flex: 0,
              padding: '0.5rem 0.625rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              fontFamily: 'var(--font-body)',
              color: isFavorite ? 'var(--color-accent)' : 'var(--color-text-primary)',
              background: isFavorite ? 'rgba(var(--rgb-accent), 0.12)' : 'rgba(var(--rgb-primary), 0.06)',
              border: `1px solid ${isFavorite ? 'rgba(var(--rgb-accent), 0.3)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                fill={isFavorite ? 'currentColor' : 'none'}
              />
            </svg>
          </button>
        )}
        <button
          onClick={handleDownload}
          disabled={disabled || !activeUrl}
          className="result-action-btn"
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            color: 'var(--color-text-primary)',
            background: 'rgba(var(--rgb-primary), 0.06)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            cursor: disabled || !activeUrl ? 'default' : 'pointer',
            opacity: disabled || !activeUrl ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          Download
        </button>
      </div>

      {/* Expanded preset chips */}
      {expandedAction && presets.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.375rem',
            animation: 'chipsFadeIn 0.2s ease-out',
          }}
        >
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handlePresetClick(preset.message)}
              disabled={disabled}
              style={{
                padding: '0.3125rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                fontFamily: 'var(--font-body)',
                color: 'var(--color-text-secondary)',
                background: 'rgba(var(--rgb-accent), 0.06)',
                border: '1px solid rgba(var(--rgb-accent), 0.2)',
                borderRadius: '999px',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
