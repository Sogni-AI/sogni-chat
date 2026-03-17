/**
 * A single session row in the chat history sidebar.
 * ChatGPT-inspired: text-only, flat, dark theme.
 * Supports right-click (desktop) and long-press (mobile) context menus,
 * inline rename, and pin/unpin.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSessionSummary } from '@/types/chat';
import { ChatContextMenu, type ContextMenuAction } from './ChatContextMenu';

interface ChatHistoryItemProps {
  session: ChatSessionSummary;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onTogglePin: (id: string) => void;
  /** Always show the delete button (for touch devices where hover doesn't apply) */
  alwaysShowDelete?: boolean;
  /** Whether this session has unread results */
  isUnread?: boolean;
  /** Whether this session has a running background job */
  hasActiveJob?: boolean;
}

/** Fallback for raw numeric filenames or browser-generated names that slipped through as titles */
function displayTitle(title: string): string {
  const trimmed = title.trim();
  if (/^\d[\d\s_-]*$/.test(trimmed)) return 'Untitled Session';
  if (/^(images?|photos?|downloads?|pictures?|files?|untitled|screenshot)(\s*\(\d+\))?$/i.test(trimmed)) return 'Untitled Session';
  const alphanumeric = trimmed.replace(/[^a-zA-Z0-9]/g, '');
  if (alphanumeric.length > 0) {
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (digitCount / alphanumeric.length > 0.6) return 'Untitled Session';
  }
  return title;
}

// Long-press duration in ms
const LONG_PRESS_MS = 500;

export function ChatHistoryItem({
  session, isActive, onSelect, onDelete, onRename, onTogglePin,
  alwaysShowDelete, isUnread, hasActiveJob,
}: ChatHistoryItemProps) {
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchMoved = useRef(false);
  const renameSubmittedRef = useRef(false);

  // Clean up long-press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const openContextMenu = useCallback((x: number, y: number) => {
    setContextMenu({ x, y });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Right-click handler (desktop)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY);
  }, [openContextMenu]);

  // Long-press handlers (mobile)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchMoved.current = false;
    longPressFiredRef.current = false;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimerRef.current = setTimeout(() => {
      if (!touchMoved.current) {
        longPressFiredRef.current = true;
        openContextMenu(x, y);
      }
    }, LONG_PRESS_MS);
  }, [openContextMenu]);

  const handleTouchMove = useCallback(() => {
    touchMoved.current = true;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    // Suppress synthetic click after long-press opened context menu
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (isRenaming || contextMenu) return;
    onSelect(session.id);
  }, [isRenaming, contextMenu, onSelect, session.id]);

  // Context menu actions
  const menuActions: ContextMenuAction[] = [
    {
      label: session.pinned ? 'Unpin' : 'Pin',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {session.pinned ? (
            // Unpin icon: pin with slash
            <>
              <line x1="2" y1="2" x2="22" y2="22" />
              <path d="M12 17v5" />
              <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9" />
              <path d="M9 3h6v6H9z" />
            </>
          ) : (
            // Pin icon
            <>
              <path d="M12 17v5" />
              <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9" />
              <path d="M9 3h6v6H9z" />
            </>
          )}
        </svg>
      ),
      onClick: () => onTogglePin(session.id),
    },
    {
      label: 'Rename',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      ),
      onClick: () => {
        renameSubmittedRef.current = false;
        setRenameValue(session.title);
        setIsRenaming(true);
      },
    },
    {
      label: 'Delete',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      ),
      onClick: () => onDelete(session.id),
      danger: true,
    },
  ];

  const handleRenameSubmit = useCallback(() => {
    if (renameSubmittedRef.current) return;
    renameSubmittedRef.current = true;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, session.id, session.title, onRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      renameSubmittedRef.current = true; // prevent blur from saving
      setIsRenaming(false);
    }
  }, [handleRenameSubmit]);

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: (hovered || alwaysShowDelete) && !isRenaming
          ? '0.5rem 2rem 0.5rem 0.75rem'
          : '0.5rem 0.75rem',
        cursor: isRenaming ? 'default' : 'pointer',
        borderRadius: 'var(--radius-lg)',
        background: isActive
          ? 'rgba(255, 255, 255, 0.08)'
          : hovered
            ? 'rgba(255, 255, 255, 0.04)'
            : 'transparent',
        transition: 'background 0.15s',
        position: 'relative',
        marginBottom: '1px',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      {/* Title + indicators */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        {/* Pin indicator */}
        {session.pinned && !isRenaming && (
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, color: '#8e8e8e' }}
          >
            <path d="M12 17v5" />
            <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9" />
            <path d="M9 3h6v6H9z" />
          </svg>
        )}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '0.8125rem',
              fontWeight: 400,
              color: '#ececec',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              padding: '1px 4px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            maxLength={80}
          />
        ) : (
          <div
            style={{
              fontSize: '0.8125rem',
              fontWeight: isUnread ? 600 : 400,
              color: isActive ? '#ececec' : '#b4b4b4',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
              minWidth: 0,
            }}
          >
            {displayTitle(session.title)}
          </div>
        )}

        {isUnread && !isRenaming && (
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#ececec',
              flexShrink: 0,
            }}
            title="New results"
          />
        )}
        {hasActiveJob && !isUnread && !isRenaming && (
          <div
            className="chat-session-spinner"
            title="Processing..."
            style={{
              width: '12px',
              height: '12px',
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {/* Delete button — visible on hover (desktop) or always (mobile), hidden during rename */}
      {!isRenaming && (hovered || alwaysShowDelete) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
          title="Delete session"
          style={{
            position: 'absolute',
            right: '0.5rem',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '0.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8e8e8e',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ChatContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={menuActions}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
