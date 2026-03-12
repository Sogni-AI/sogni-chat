/**
 * Chat History Sidebar — ChatGPT-inspired dark flat design.
 * Desktop: Fixed ~260px width alongside chat panel.
 * Mobile: Rendered inside MobileChatDrawer with full-width + close button.
 */

import { useState, useCallback, type CSSProperties, type DragEvent } from 'react';
import type { ChatSessionSummary } from '@/types/chat';
import { ChatHistoryItem } from './ChatHistoryItem';

interface ChatHistorySidebarProps {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  getThumbnailUrl: (sessionId: string) => Promise<string | null>;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
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
}

export function ChatHistorySidebar({
  sessions,
  activeSessionId,
  getThumbnailUrl,
  onSelectSession,
  onDeleteSession,
  onNewProject,
  onFileDrop,
  onClose,
  isMobile,
  style,
  unreadSessionIds,
  activeJobSessionIds,
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

  return (
    <div
      style={{
        width: '260px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#171717',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Header with close button (mobile) + New Chat button */}
      <div
        style={{
          padding: '0.75rem',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
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
        <button
          onClick={onNewProject}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            flex: 1,
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
        {sessions.length === 0 ? (
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
          sessions.map((session) => (
            <ChatHistoryItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isUnread={unreadSessionIds?.has(session.id) ?? false}
              hasActiveJob={activeJobSessionIds?.has(session.id) ?? false}
              getThumbnailUrl={getThumbnailUrl}
              onSelect={onSelectSession}
              onDelete={onDeleteSession}
              alwaysShowDelete={isMobile}
            />
          ))
        )}
      </div>
    </div>
  );
}
