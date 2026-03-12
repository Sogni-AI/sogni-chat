/**
 * Authentication status indicator for the header — dark theme.
 */

import { useSogniAuth } from '@/services/sogniAuth';
import { useLayout } from '@/layouts/AppLayout';

export function AuthStatus() {
  const { isAuthenticated, user, logout } = useSogniAuth();
  const { showSignupModal } = useLayout();

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
    <div className="flex items-center gap-3">
      <span className="text-sm" style={{ color: '#b4b4b4' }}>
        {user?.username}
      </span>
      <button
        onClick={logout}
        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: 'transparent',
          color: '#8e8e8e',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 'var(--radius-pill)',
          cursor: 'pointer',
        }}
      >
        Sign Out
      </button>
    </div>
  );
}
