/**
 * Chat History Sidebar — ChatGPT-inspired dark flat design.
 * Supports expanded (260px) and collapsed (icon-only, 52px) modes.
 * Desktop: Fixed width alongside chat panel, full height.
 * Mobile: Rendered inside MobileChatDrawer with full-width + close button.
 */

import { useState, useCallback, useMemo, type CSSProperties, type DragEvent } from 'react';
import type { ChatSessionSummary } from '@/types/chat';
import { ChatHistoryItem } from './ChatHistoryItem';

interface ChatHistorySidebarProps {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onTogglePinSession: (id: string) => void;
  onNewProject: () => void;
  /** Called when a file is dropped onto the New Photo button */
  onFileDrop?: (file: File) => void;
  /** When provided, renders a close button in the header (used by mobile drawer) */
  onClose?: () => void;
  /** When true, renders delete buttons always visible (touch devices) */
  isMobile?: boolean;
  /** Style overrides for the root container */
  style?: CSSProperties;
  /** Session IDs that have unread results */
  unreadSessionIds?: Set<string>;
  /** Session IDs that have actively running background jobs */
  activeJobSessionIds?: Set<string>;
  /** Whether sidebar is in collapsed (icon-only) mode */
  collapsed?: boolean;
  /** Toggle sidebar collapse state */
  onToggleCollapse?: () => void;
}

export function ChatHistorySidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onNewProject,
  onFileDrop,
  onClose,
  isMobile,
  style,
  unreadSessionIds,
  activeJobSessionIds,
  collapsed = false,
  onToggleCollapse,
}: ChatHistorySidebarProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/') && onFileDrop) {
      onFileDrop(file);
    }
  }, [onFileDrop]);

  // Sort pinned sessions to top while preserving updatedAt order within each group
  const sortedSessions = useMemo(() => {
    const pinned = sessions.filter(s => s.pinned);
    const unpinned = sessions.filter(s => !s.pinned);
    return [...pinned, ...unpinned];
  }, [sessions]);

  const sidebarWidth = collapsed ? '52px' : '260px';

  return (
    <div
      className="sidebar-transition"
      style={{
        width: sidebarWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#171717',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Top section: Logo + collapse toggle */}
      <div
        style={{
          padding: collapsed ? '0.75rem 0.5rem' : '0.75rem',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: '0.5rem',
          minHeight: '3rem',
        }}
      >
        {/* Logo icon */}
        <button
          onClick={onNewProject}
          aria-label="New chat"
          title="New chat"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0.25rem',
            borderRadius: 'var(--radius-sm)',
            transition: 'opacity 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <img
            src="/Sogni_Moon.svg"
            alt="Sogni"
            style={{ width: '28px', height: '28px', borderRadius: '50%' }}
          />
        </button>

        {/* Sidebar toggle (only in expanded mode header — in collapsed mode it's in the icon nav below) */}
        {!collapsed && !onClose && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              width: '2rem',
              height: '2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: '#8e8e8e',
              flexShrink: 0,
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.background = 'transparent'; }}
          >
            {/* Sidebar toggle icon - double panel icon like ChatGPT */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        )}

        {/* Close button for mobile drawer */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close session drawer"
            style={{
              width: '2rem',
              height: '2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: '#b4b4b4',
              flexShrink: 0,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#b4b4b4'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Collapsed mode: icon-only nav */}
      {collapsed && !onClose && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0' }}>
          {/* Sidebar toggle */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              style={{
                width: '2.25rem',
                height: '2.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: '#8e8e8e',
                transition: 'color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          )}
          {/* New chat icon */}
          <button
            onClick={onNewProject}
            onDragOver={handleDragOver as any}
            onDragLeave={handleDragLeave as any}
            onDrop={handleDrop as any}
            aria-label="New chat"
            title="New chat"
            style={{
              width: '2.25rem',
              height: '2.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: '#b4b4b4',
              transition: 'color 0.15s, background 0.15s',
              opacity: dragOver ? 0.8 : undefined,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#b4b4b4'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>
      )}

      {/* Expanded mode: New Chat button + session list */}
      {!collapsed && (
        <>
          {/* New Chat button */}
          <div style={{ padding: '0 0.75rem 0.5rem', flexShrink: 0 }}>
            <button
              onClick={onNewProject}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#ececec',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 'var(--radius-lg)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'background 0.15s, border-color 0.15s',
                opacity: dragOver ? 0.8 : undefined,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New chat
            </button>
          </div>

          {/* Session list */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0.25rem 0.5rem',
            }}
          >
            {sortedSessions.length === 0 ? (
              <div
                style={{
                  padding: '1.5rem 0.75rem',
                  textAlign: 'center',
                  fontSize: '0.8125rem',
                  color: '#8e8e8e',
                }}
              >
                No chats yet
              </div>
            ) : (
              sortedSessions.map((session) => (
                <ChatHistoryItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isUnread={unreadSessionIds?.has(session.id) ?? false}
                  hasActiveJob={activeJobSessionIds?.has(session.id) ?? false}
                  onSelect={onSelectSession}
                  onDelete={onDeleteSession}
                  onRename={onRenameSession}
                  onTogglePin={onTogglePinSession}
                  alwaysShowDelete={isMobile}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
