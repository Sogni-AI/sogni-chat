/**
 * Authentication status indicator for the header.
 * Shows login button when unauthenticated, user info when authenticated.
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
          background: 'var(--color-primary)',
          color: 'white',
        }}
      >
        Sign In
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {user?.username}
      </span>
      <button
        onClick={logout}
        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        Sign Out
      </button>
    </div>
  );
}
