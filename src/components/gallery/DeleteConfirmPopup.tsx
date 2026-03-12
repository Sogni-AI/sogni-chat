/**
 * DeleteConfirmPopup - Inline confirmation popup for project deletion.
 *
 * Renders via a React portal so it escapes parent overflow:hidden containers.
 * Positions itself relative to the provided anchorRef element.
 */

import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const SESSION_KEY = 'gallery-skip-delete-confirm';

interface DeleteConfirmPopupProps {
  onConfirm: () => void;
  onCancel: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function shouldSkipDeleteConfirm(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === 'true';
}

const DeleteConfirmPopup: React.FC<DeleteConfirmPopupProps> = ({
  onConfirm,
  onCancel,
  anchorRef,
}) => {
  const [dontAsk, setDontAsk] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.top + window.scrollY - 8,
      left: rect.right + window.scrollX,
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onCancel, anchorRef]);

  const handleConfirm = () => {
    if (dontAsk) {
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
    onConfirm();
  };

  const popup = (
    <div
      ref={popupRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: pos ? pos.top : 0,
        left: pos ? pos.left : 0,
        transform: 'translate(-100%, -100%)',
        zIndex: 10000,
        background: 'var(--color-surface, #212121)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        boxShadow: 'var(--shadow-lg)',
        minWidth: '260px',
        animation: 'fadeIn 0.15s ease-out',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-primary)',
          fontSize: '0.85rem',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          margin: '0 0 6px 0',
          lineHeight: 1.4,
        }}
      >
        Delete this project and all its media?
      </p>
      <p
        style={{
          fontFamily: 'var(--font-primary)',
          fontSize: '0.78rem',
          color: 'var(--color-text-tertiary)',
          margin: '0 0 12px 0',
        }}
      >
        This cannot be undone.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
          marginBottom: '12px',
          fontFamily: 'var(--font-primary)',
          fontSize: '0.78rem',
          color: 'var(--color-text-secondary)',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
          style={{
            width: '14px',
            height: '14px',
            accentColor: 'var(--color-accent)',
            cursor: 'pointer',
            margin: 0,
          }}
        />
        Don't ask again this session
      </label>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 14px',
            fontSize: '0.8rem',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-primary)',
            transition: 'all var(--transition-fast)',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          style={{
            background: '#c0392b',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 14px',
            fontSize: '0.8rem',
            fontWeight: 500,
            color: 'white',
            cursor: 'pointer',
            fontFamily: 'var(--font-primary)',
            transition: 'all var(--transition-fast)',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
};

export default DeleteConfirmPopup;
