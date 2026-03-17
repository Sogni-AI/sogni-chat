/**
 * 3-dot actions menu for generated media results.
 * Shows Save, Favorite, "Branch in new chat" and "Retry" options with model switching.
 *
 * Mobile-first: on narrow viewports the retry submenu expands inline
 * instead of flying out to the right (which would overflow the screen).
 * Touch targets are sized to at least 44px for comfortable tapping.
 */
import { memo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { UIChatMessage } from '@/types/chat';
import { getModelOptions } from '@/tools/shared/modelRegistry';
import type { ModelOption } from '@/tools/shared/modelRegistry';
import { downloadImage } from '@/utils/download';
import { buildDownloadFilename } from '@/utils/downloadFilename';
import { useGalleryBlobUrls } from '@/hooks/useGalleryBlobUrls';
import { toggleFavorite as dbToggleFavorite, getImage } from '@/utils/galleryDB';

/** Breakpoint below which we use inline submenu instead of flyout */
const MOBILE_BREAKPOINT = 744;

interface MediaActionsMenuProps {
  message: UIChatMessage;
  onBranchChat?: (message: UIChatMessage) => void;
  onRetry?: (message: UIChatMessage, modelKey?: string) => void;
  /** Type of media being displayed */
  mediaType?: 'image' | 'video' | 'audio';
  /** URLs of the media results */
  mediaUrls?: string[];
  /** Gallery image IDs for favorite toggle and persistent blob downloads */
  galleryImageIds?: string[];
  /** Gallery video IDs for persistent blob downloads */
  galleryVideoIds?: string[];
  /** Descriptive slug for download filenames */
  downloadSlug?: string;
  /** Index of the currently active/playing media item (video or audio) */
  activeMediaIndex?: number;
}

export const MediaActionsMenu = memo(function MediaActionsMenu({
  message,
  onBranchChat,
  onRetry,
  mediaType,
  mediaUrls,
  galleryImageIds,
  galleryVideoIds,
  downloadSlug,
  activeMediaIndex = 0,
}: MediaActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [showRetrySubmenu, setShowRetrySubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);

  const toolName = message.lastCompletedTool;
  const currentModelKey = message.toolModelKey;

  // Get model options for the tool
  const allModels = toolName ? getModelOptions(toolName) : [];
  const hasModelOptions = allModels.length > 1;
  const hasToolArgs = !!message.toolArgs && !!toolName;

  // --- Download / Favorite support ---
  // Resolve gallery blob URLs for persistent downloads (images + videos)
  const blobIds = mediaType === 'image' ? galleryImageIds
    : mediaType === 'video' ? galleryVideoIds
    : undefined;
  const galleryBlobUrls = useGalleryBlobUrls(blobIds);
  const hasGalleryIds = !!galleryImageIds && galleryImageIds.length > 0;

  // Track favorite state for gallery images
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const allFavorited = hasGalleryIds && galleryImageIds!.every(id => favoriteIds.has(id));

  // Load favorite state when gallery IDs are available
  useEffect(() => {
    if (!hasGalleryIds) return;
    let cancelled = false;
    const loadFavorites = async () => {
      const favs = new Set<string>();
      for (const id of galleryImageIds!) {
        try {
          const img = await getImage(id);
          if (img?.isFavorite) favs.add(id);
        } catch { /* ignore */ }
      }
      if (!cancelled) setFavoriteIds(favs);
    };
    loadFavorites();
    return () => { cancelled = true; };
  }, [galleryImageIds, hasGalleryIds]);

  // Whether we have multiple items and should show "Save current" + "Save all"
  const isMulti = !!mediaUrls && mediaUrls.length > 1;
  const filenameType = mediaType === 'video' ? 'video' as const : mediaType === 'audio' ? 'audio' as const : 'restored' as const;

  // Labels for single vs multi
  const singleLabel = mediaType === 'video' ? 'Save video' : mediaType === 'audio' ? 'Save audio' : 'Save image';
  const currentLabel = mediaType === 'video' ? 'Save current video' : mediaType === 'audio' ? 'Save current track' : singleLabel;
  const allLabel = mediaType === 'video' ? 'Save all videos' : mediaType === 'audio' ? 'Save all tracks' : 'Save all images';

  // Download a single item by index
  const downloadOne = useCallback((index: number) => {
    if (!mediaUrls?.[index]) return;
    const displayUrl = galleryBlobUrls.get(index) || mediaUrls[index];
    const filename = buildDownloadFilename(
      downloadSlug,
      mediaUrls.length > 1 ? index + 1 : undefined,
      filenameType,
    );
    downloadImage(displayUrl, filename).catch(err =>
      console.error('[MEDIA MENU] Download failed:', err),
    );
  }, [mediaUrls, galleryBlobUrls, downloadSlug, filenameType]);

  // Download all items
  const handleDownloadAll = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mediaUrls?.length) return;
    setOpen(false);
    mediaUrls.forEach((_url, index) => {
      // Stagger downloads to avoid overwhelming the browser
      setTimeout(() => downloadOne(index), index * 300);
    });
  }, [mediaUrls, downloadOne]);

  // Download the currently active item
  const handleDownloadCurrent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    downloadOne(activeMediaIndex);
  }, [downloadOne, activeMediaIndex]);

  const handleToggleFavorite = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!galleryImageIds?.length) return;
    setOpen(false);

    const shouldFavorite = !allFavorited;
    // Optimistic update
    setFavoriteIds(prev => {
      const next = new Set(prev);
      for (const id of galleryImageIds) {
        shouldFavorite ? next.add(id) : next.delete(id);
      }
      return next;
    });

    // Persist — only toggle images that need to change
    for (const id of galleryImageIds) {
      const currentlyFavorited = favoriteIds.has(id);
      if (currentlyFavorited !== shouldFavorite) {
        try {
          const newVal = await dbToggleFavorite(id);
          setFavoriteIds(prev => {
            const next = new Set(prev);
            newVal ? next.add(id) : next.delete(id);
            return next;
          });
        } catch { /* ignore */ }
      }
    }
  }, [galleryImageIds, allFavorited, favoriteIds]);

  // Track viewport width for mobile vs desktop layout
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Close menu on outside click or escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowRetrySubmenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowRetrySubmenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick, { passive: true });
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Clamp desktop flyout submenu within viewport
  useLayoutEffect(() => {
    const el = submenuRef.current;
    if (!el || !showRetrySubmenu || isMobile) return;
    el.style.maxHeight = '';
    el.style.bottom = '0';
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const available = rect.bottom - pad;
    if (rect.height > available) {
      el.style.maxHeight = `${available}px`;
      // Shift down so top doesn't go above viewport
      const overflow = rect.height - available;
      el.style.bottom = `${-overflow}px`;
    }
  }, [showRetrySubmenu, isMobile]);

  // Clamp mobile dropdown when inline model list expands
  useLayoutEffect(() => {
    const el = dropdownRef.current;
    if (!el || !open || !isMobile) return;
    el.style.maxHeight = '';
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const available = rect.bottom - pad;
    if (rect.height > available) {
      el.style.maxHeight = `${available}px`;
    }
  }, [open, isMobile, showRetrySubmenu]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
    setShowRetrySubmenu(false);
  }, []);

  const handleBranch = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onBranchChat?.(message);
  }, [message, onBranchChat]);

  const handleTryAgain = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    setShowRetrySubmenu(false);
    onRetry?.(message);
  }, [message, onRetry]);

  const handleSwitchModel = useCallback((e: React.MouseEvent, modelKey: string) => {
    e.stopPropagation();
    setOpen(false);
    setShowRetrySubmenu(false);
    onRetry?.(message, modelKey);
  }, [message, onRetry]);

  const toggleRetrySubmenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRetrySubmenu(prev => !prev);
  }, []);

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* 3-dot trigger button */}
      <button
        onClick={handleToggle}
        aria-label="Media actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: open ? 'rgba(255,255,255,0.08)' : 'none',
          border: 'none',
          padding: '4px',
          cursor: 'pointer',
          color: open ? '#ececec' : 'var(--color-text-tertiary)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s, background 0.15s',
          minWidth: '28px',
          minHeight: '28px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#ececec';
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.color = 'var(--color-text-tertiary)';
            e.currentTarget.style.background = 'none';
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          ref={dropdownRef}
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            background: '#2a2a2a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 50,
            minWidth: isMobile ? '220px' : '200px',
            overflow: isMobile ? 'hidden auto' : 'visible',
            padding: '4px 0',
          }}
        >
          {/* Save / Download */}
          {mediaUrls && mediaUrls.length > 0 && (
            isMulti && (mediaType === 'video' || mediaType === 'audio') ? (
              /* Video / Audio with multiple items: "Save current" + "Save all" */
              <>
                <MenuItem
                  icon={<DownloadIcon />}
                  label={currentLabel}
                  onClick={handleDownloadCurrent}
                  isMobile={isMobile}
                />
                <MenuItem
                  icon={<DownloadIcon />}
                  label={allLabel}
                  onClick={handleDownloadAll}
                  isMobile={isMobile}
                />
              </>
            ) : (
              /* Single item or images: single save button */
              <MenuItem
                icon={<DownloadIcon />}
                label={isMulti ? allLabel : singleLabel}
                onClick={handleDownloadAll}
                isMobile={isMobile}
              />
            )
          )}

          {/* Favorite toggle — images with gallery IDs only */}
          {hasGalleryIds && (
            <MenuItem
              icon={<HeartIcon filled={!!allFavorited} />}
              label={
                allFavorited
                  ? (galleryImageIds!.length > 1 ? 'Unfavorite all' : 'Unfavorite')
                  : (galleryImageIds!.length > 1 ? 'Favorite all' : 'Favorite')
              }
              onClick={handleToggleFavorite}
              isMobile={isMobile}
            />
          )}

          {/* Divider before Branch/Retry */}
          {(mediaUrls?.length || hasGalleryIds) && (onBranchChat || (hasToolArgs && onRetry)) && (
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
          )}

          {/* Branch in new chat */}
          {onBranchChat && (
            <MenuItem
              icon={<BranchIcon />}
              label="Branch in new chat"
              onClick={handleBranch}
              isMobile={isMobile}
            />
          )}

          {/* Retry section — only if we have tool args */}
          {hasToolArgs && onRetry && (
            <>
              {/* Divider between Branch and Retry (only when Branch actually rendered) */}
              {onBranchChat && (
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
              )}

              {hasModelOptions ? (
                isMobile ? (
                  /* Mobile: inline expansion — no flyout */
                  <>
                    <MenuItem
                      icon={<RetryIcon />}
                      label="Retry"
                      hasSubmenu
                      expanded={showRetrySubmenu}
                      onClick={toggleRetrySubmenu}
                      isMobile={isMobile}
                    />
                    {showRetrySubmenu && (
                      <div style={{ padding: '0 0 0 8px' }}>
                        <MenuItem
                          icon={<RetryIcon />}
                          label="Try again"
                          onClick={handleTryAgain}
                          isMobile={isMobile}
                        />
                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
                        <div style={{
                          padding: '4px 12px',
                          fontSize: '0.6875rem',
                          color: '#666',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          Switch model
                        </div>
                        {allModels.map((model) => (
                          <ModelMenuItem
                            key={model.key}
                            model={model}
                            isCurrent={model.key === currentModelKey}
                            onClick={handleSwitchModel}
                            isMobile={isMobile}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  /* Desktop: flyout submenu on hover */
                  <div
                    style={{ position: 'relative' }}
                    onMouseEnter={() => setShowRetrySubmenu(true)}
                    onMouseLeave={() => setShowRetrySubmenu(false)}
                  >
                    <MenuItem
                      icon={<RetryIcon />}
                      label="Retry"
                      hasSubmenu
                      onClick={toggleRetrySubmenu}
                      isMobile={false}
                    />

                    {showRetrySubmenu && (
                      <div
                        ref={submenuRef}
                        role="menu"
                        style={{
                          position: 'absolute',
                          left: 'calc(100% + 4px)',
                          bottom: 0,
                          background: '#2a2a2a',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '0.5rem',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                          zIndex: 51,
                          minWidth: '200px',
                          overflowY: 'auto',
                          padding: '4px 0',
                        }}
                      >
                        <MenuItem
                          icon={<RetryIcon />}
                          label="Try again"
                          onClick={handleTryAgain}
                          isMobile={false}
                        />
                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
                        <div style={{
                          padding: '4px 12px',
                          fontSize: '0.6875rem',
                          color: '#666',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          Switch model
                        </div>
                        {allModels.map((model) => (
                          <ModelMenuItem
                            key={model.key}
                            model={model}
                            isCurrent={model.key === currentModelKey}
                            onClick={handleSwitchModel}
                            isMobile={false}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* Simple retry (no model options) */
                <MenuItem
                  icon={<RetryIcon />}
                  label="Try again"
                  onClick={handleTryAgain}
                  isMobile={isMobile}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MenuItem({ icon, label, onClick, hasSubmenu, expanded, isMobile }: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  hasSubmenu?: boolean;
  expanded?: boolean;
  isMobile: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: isMobile ? '10px 12px' : '8px 12px',
        minHeight: isMobile ? '44px' : undefined,
        background: 'transparent',
        border: 'none',
        color: '#d4d4d4',
        fontSize: isMobile ? '0.875rem' : '0.8125rem',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hasSubmenu && (
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            opacity: 0.5,
            transition: 'transform 0.15s',
            // On mobile, rotate chevron down when expanded (inline mode)
            transform: (isMobile && expanded) ? 'rotate(90deg)' : 'none',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </button>
  );
}

function ModelMenuItem({ model, isCurrent, onClick, isMobile }: {
  model: ModelOption;
  isCurrent: boolean;
  onClick: (e: React.MouseEvent, key: string) => void;
  isMobile: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={(e) => onClick(e, model.key)}
      disabled={isCurrent}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: isMobile ? '10px 12px' : '8px 12px',
        minHeight: isMobile ? '44px' : undefined,
        background: 'transparent',
        border: 'none',
        color: isCurrent ? 'var(--color-accent)' : '#d4d4d4',
        fontSize: isMobile ? '0.875rem' : '0.8125rem',
        cursor: isCurrent ? 'default' : 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
        opacity: isCurrent ? 0.8 : 1,
      }}
      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {isCurrent ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <span style={{ width: 14, flexShrink: 0 }} />
      )}
      <span>{model.displayName}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  );
}
