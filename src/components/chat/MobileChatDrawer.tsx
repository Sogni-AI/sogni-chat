/**
 * Mobile slide-out drawer for chat session history.
 * Renders ChatHistorySidebar in a left-edge drawer with backdrop.
 * Closes on backdrop tap, session select, Escape key, or close button.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatSessionSummary } from '@/types/chat';
import { ChatHistorySidebar } from './ChatHistorySidebar';

interface MobileChatDrawerProps {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  getThumbnailUrl: (sessionId: string) => Promise<string | null>;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewProject: () => void;
  onFileDrop?: (file: File) => void;
  onClose: () => void;
  unreadSessionIds?: Set<string>;
  activeJobSessionIds?: Set<string>;
}

export function MobileChatDrawer({
  sessions,
  activeSessionId,
  getThumbnailUrl,
  onSelectSession,
  onDeleteSession,
  onNewProject,
  onFileDrop,
  onClose,
  unreadSessionIds,
  activeJobSessionIds,
}: MobileChatDrawerProps) {
  const [closing, setClosing] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Lock body scroll while drawer is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClosing(true);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
  }, []);

  // Fires when the panel slide-out animation ends — unmounts the drawer and
  // executes any deferred action (session switch, new project).
  const handlePanelAnimationEnd = useCallback(() => {
    if (!closing) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    onClose();
    // Fire deferred action after unmount
    if (action) action();
  }, [closing, onClose]);

  const handleSelectSession = useCallback((id: string) => {
    pendingActionRef.current = () => onSelectSession(id);
    setClosing(true);
  }, [onSelectSession]);

  const handleNewProject = useCallback(() => {
    pendingActionRef.current = () => onNewProject();
    setClosing(true);
  }, [onNewProject]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`mobile-drawer-backdrop${closing ? ' closing' : ''}`}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        className={`mobile-drawer-panel${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Chat history"
        onAnimationEnd={handlePanelAnimationEnd}
      >
        <ChatHistorySidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          getThumbnailUrl={getThumbnailUrl}
          onSelectSession={handleSelectSession}
          onDeleteSession={onDeleteSession}
          onNewProject={handleNewProject}
          onFileDrop={onFileDrop}
          onClose={handleClose}
          isMobile
          unreadSessionIds={unreadSessionIds}
          activeJobSessionIds={activeJobSessionIds}
          style={{
            width: '100%',
            borderRadius: 0,
            borderRight: 'none',
            height: '100%',
          }}
        />
      </div>
    </>
  );
}
