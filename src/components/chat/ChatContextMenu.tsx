/**
 * Context menu for chat history items.
 * Appears on right-click (desktop) or long-press (mobile).
 * Renders in a portal with fixed positioning to avoid overflow clipping.
 */

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './ChatContextMenu.css';

export interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface ChatContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function ChatContextMenu({ x, y, actions, onClose }: ChatContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep menu within viewport (useLayoutEffect to avoid flicker)
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    let ax = x;
    let ay = y;
    if (ax + rect.width > window.innerWidth - 8) {
      ax = window.innerWidth - rect.width - 8;
    }
    if (ay + rect.height > window.innerHeight - 8) {
      ay = window.innerHeight - rect.height - 8;
    }
    if (ax < 8) ax = 8;
    if (ay < 8) ay = 8;
    menu.style.left = `${ax}px`;
    menu.style.top = `${ay}px`;
  }, [x, y]);

  // Close on outside click/touch, scroll, or Escape
  useEffect(() => {
    const handleOutsideEvent = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Use setTimeout to avoid immediately closing from the same event that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideEvent);
      document.addEventListener('touchstart', handleOutsideEvent, { passive: true });
      document.addEventListener('scroll', handleScroll, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutsideEvent);
      document.removeEventListener('touchstart', handleOutsideEvent);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleAction = useCallback((action: ContextMenuAction) => {
    onClose();
    action.onClick();
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="chat-context-menu"
      style={{ left: x, top: y }}
      role="menu"
    >
      {actions.map((action) => (
        <button
          key={action.label}
          className={`chat-context-menu-item${action.danger ? ' danger' : ''}`}
          onClick={() => handleAction(action)}
          role="menuitem"
        >
          <span className="chat-context-menu-icon">{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
