/**
 * A single session row in the chat history sidebar.
 * Shows thumbnail, title, relative timestamp, and delete button on hover.
 */

import { useState, useEffect, useCallback } from 'react';
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

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Fallback for raw numeric filenames or browser-generated names that slipped through as titles */
function displayTitle(title: string): string {
  const trimmed = title.trim();
  if (/^\d[\d\s_-]*$/.test(trimmed)) return 'Untitled Session';
  // Browser-generated filenames: "images (3)", "photo (1)", "download", "Untitled", etc.
  if (/^(images?|photos?|downloads?|pictures?|files?|untitled|screenshot)(\s*\(\d+\))?$/i.test(trimmed)) return 'Untitled Session';
  // Predominantly digits (>60%): social media filenames like "646376662 10226279100 n"
  const alphanumeric = trimmed.replace(/[^a-zA-Z0-9]/g, '');
  if (alphanumeric.length > 0) {
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (digitCount / alphanumeric.length > 0.6) return 'Untitled Session';
  }
  return title;
}

export function ChatHistoryItem({ session, isActive, getThumbnailUrl, onSelect, onDelete, alwaysShowDelete, isUnread, hasActiveJob }: ChatHistoryItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getThumbnailUrl(session.id).then((url) => {
      if (!cancelled && url !== thumbUrl) setThumbUrl(url);
    });
    return () => { cancelled = true; };
    // Re-fetch when session updates or when sessions list refreshes (new object ref → thumbnail may now be cached)
  }, [session, getThumbnailUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
        gap: '0.625rem',
        padding: '0.5rem 0.75rem',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        borderLeft: isActive ? '3px solid var(--color-accent)' : '3px solid transparent',
        background: isActive
          ? 'rgba(var(--rgb-accent), 0.08)'
          : hovered
            ? 'rgba(var(--rgb-primary), 0.04)'
            : 'transparent',
        transition: 'background 0.15s, border-color 0.15s',
        position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          flexShrink: 0,
          background: 'rgba(var(--rgb-primary), 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        )}
      </div>

      {/* Title + time */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <div
            style={{
              fontSize: '0.8125rem',
              fontWeight: isUnread ? 600 : 500,
              color: 'var(--color-text-primary)',
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
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--color-accent)',
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
        <div
          style={{
            fontSize: '0.6875rem',
            color: 'var(--color-text-secondary)',
            opacity: 0.7,
            marginTop: '0.125rem',
          }}
        >
          {relativeTime(session.updatedAt)}
        </div>
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
            background: 'rgba(var(--rgb-primary), 0.08)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '0.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
            opacity: 0.6,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
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
