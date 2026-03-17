/**
 * 3-dot actions menu for generated media results.
 * Shows "Branch in new chat" and "Retry" options with model switching.
 */
import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { UIChatMessage } from '@/types/chat';
import { getModelOptions } from '@/tools/shared/modelRegistry';
import type { ModelOption } from '@/tools/shared/modelRegistry';

interface MediaActionsMenuProps {
  message: UIChatMessage;
  onBranchChat: (message: UIChatMessage) => void;
  onRetry: (message: UIChatMessage, modelKey?: string) => void;
}

export const MediaActionsMenu = memo(function MediaActionsMenu({
  message,
  onBranchChat,
  onRetry,
}: MediaActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [showRetrySubmenu, setShowRetrySubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toolName = message.lastCompletedTool;
  const currentModelKey = message.toolModelKey;

  // Get model options for the tool
  const allModels = toolName ? getModelOptions(toolName) : [];
  const hasModelOptions = allModels.length > 1;
  const hasToolArgs = !!message.toolArgs && !!toolName;

  // Close menu on outside click or escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
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
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
    setShowRetrySubmenu(false);
  }, []);

  const handleBranch = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onBranchChat(message);
  }, [message, onBranchChat]);

  const handleTryAgain = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    setShowRetrySubmenu(false);
    onRetry(message);
  }, [message, onRetry]);

  const handleSwitchModel = useCallback((e: React.MouseEvent, modelKey: string) => {
    e.stopPropagation();
    setOpen(false);
    setShowRetrySubmenu(false);
    onRetry(message, modelKey);
  }, [message, onRetry]);

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* 3-dot trigger button */}
      <button
        onClick={handleToggle}
        aria-label="Media actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: 'none',
          border: 'none',
          padding: '4px',
          cursor: 'pointer',
          color: open ? '#ececec' : 'var(--color-text-tertiary)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s, background 0.15s',
          ...(open ? { background: 'rgba(255,255,255,0.08)' } : {}),
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
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            background: '#2a2a2a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 50,
            minWidth: '200px',
            overflow: 'visible',
            padding: '4px 0',
          }}
        >
          {/* Branch in new chat */}
          <MenuItem
            icon={<BranchIcon />}
            label="Branch in new chat"
            onClick={handleBranch}
          />

          {/* Retry section — only if we have tool args */}
          {hasToolArgs && (
            <>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

              {hasModelOptions ? (
                /* Retry with submenu */
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setShowRetrySubmenu(true)}
                  onMouseLeave={() => setShowRetrySubmenu(false)}
                >
                  <MenuItem
                    icon={<RetryIcon />}
                    label="Retry"
                    hasSubmenu
                    onClick={(e) => { e.stopPropagation(); setShowRetrySubmenu(prev => !prev); }}
                  />

                  {/* Retry submenu */}
                  {showRetrySubmenu && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 'calc(100% + 4px)',
                        top: 0,
                        background: '#2a2a2a',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '0.5rem',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                        zIndex: 51,
                        minWidth: '200px',
                        padding: '4px 0',
                      }}
                    >
                      {/* Try Again */}
                      <MenuItem
                        icon={<RetryIcon />}
                        label="Try again"
                        onClick={handleTryAgain}
                      />

                      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

                      {/* Model label */}
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

                      {/* Model options */}
                      {allModels.map((model) => (
                        <ModelMenuItem
                          key={model.key}
                          model={model}
                          isCurrent={model.key === currentModelKey}
                          onClick={handleSwitchModel}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Simple retry (no model options) */
                <MenuItem
                  icon={<RetryIcon />}
                  label="Try again"
                  onClick={handleTryAgain}
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

function MenuItem({ icon, label, onClick, hasSubmenu }: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  hasSubmenu?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: '#d4d4d4',
        fontSize: '0.8125rem',
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </button>
  );
}

function ModelMenuItem({ model, isCurrent, onClick }: {
  model: ModelOption;
  isCurrent: boolean;
  onClick: (e: React.MouseEvent, key: string) => void;
}) {
  return (
    <button
      onClick={(e) => onClick(e, model.key)}
      disabled={isCurrent}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: isCurrent ? 'var(--color-accent)' : '#d4d4d4',
        fontSize: '0.8125rem',
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
