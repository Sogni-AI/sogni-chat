/**
 * Authentication status indicator for the header — dark theme.
 * Dropdown menu under username with Safe Content Filter toggle and Sign Out.
 */

import { useState, useRef, useEffect } from 'react';
import { useSogniAuth } from '@/services/sogniAuth';
import { useLayout } from '@/layouts/AppLayout';

export function AuthStatus() {
  const { isAuthenticated, user, logout } = useSogniAuth();
  const { showSignupModal, safeContentFilter, setSafeContentFilter } = useLayout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => showSignupModal('login')}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: '#ffffff',
          color: '#0a0a0a',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          cursor: 'pointer',
        }}
      >
        Sign In
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: 'none',
          padding: '4px 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          borderRadius: 'var(--radius-sm)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
      >
        <span className="text-sm" style={{ color: '#b4b4b4' }}>
          {user?.username}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
        }}>
          <path d="M2 4L5 7L8 4" stroke="#8e8e8e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          right: 0,
          minWidth: '220px',
          background: '#2a2a2a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 100,
          padding: '4px 0',
          animation: 'dropdownFadeIn 0.15s ease',
        }}>
          {/* Safe Content Filter toggle */}
          <button
            onClick={() => setSafeContentFilter(!safeContentFilter)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            <span style={{ fontSize: '0.8125rem', color: '#d4d4d4' }}>
              Safe Content Filter
            </span>
            {/* Toggle switch */}
            <div style={{
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              background: safeContentFilter ? '#4f8f4f' : '#555',
              position: 'relative',
              transition: 'background 0.2s ease',
              flexShrink: 0,
              marginLeft: '12px',
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: '2px',
                left: safeContentFilter ? '18px' : '2px',
                transition: 'left 0.2s ease',
              }} />
            </div>
          </button>

          {/* Divider */}
          <div style={{
            height: '1px',
            background: 'rgba(255,255,255,0.08)',
            margin: '4px 0',
          }} />

          {/* Sign Out */}
          <button
            onClick={() => { setOpen(false); logout(); }}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '0.8125rem',
              color: '#8e8e8e',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#d4d4d4'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#8e8e8e'; }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
