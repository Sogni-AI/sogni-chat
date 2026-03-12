/**
 * A single session row in the chat history sidebar.
 * ChatGPT-inspired: text-only, flat, dark theme.
 */

import { useState, useCallback } from 'react';
import type { ChatSessionSummary } from '@/types/chat';

interface ChatHistoryItemProps {
  session: ChatSessionSummary;
  isActive: boolean;
  getThumbnailUrl: (sessionId: string) => Promise<string | null>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
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

export function ChatHistoryItem({ session, isActive, onSelect, onDelete, alwaysShowDelete, isUnread, hasActiveJob }: ChatHistoryItemProps) {
  const [hovered, setHovered] = useState(false);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(session.id);
  }, [session.id, onDelete]);

  return (
    <div
      onClick={() => onSelect(session.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        cursor: 'pointer',
        borderRadius: 'var(--radius-lg)',
        background: isActive
          ? 'rgba(255, 255, 255, 0.08)'
          : hovered
            ? 'rgba(255, 255, 255, 0.04)'
            : 'transparent',
        transition: 'background 0.15s',
        position: 'relative',
        marginBottom: '1px',
      }}
    >
      {/* Title + indicators */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
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
        {isUnread && (
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
        {hasActiveJob && !isUnread && (
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

      {/* Delete button — visible on hover (desktop) or always (mobile) */}
      {(hovered || alwaysShowDelete) && (
        <button
          onClick={handleDelete}
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
    </div>
  );
}
