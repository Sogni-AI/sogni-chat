import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { AuthStatus } from '@/components/auth/AuthStatus';

export function Header() {
  const { isAuthenticated } = useSogniAuth();
  const navigate = useNavigate();

  const handleLogoClick = useCallback(() => {
    navigate('/');
  }, [navigate]);

  return (
    <header className="flex-shrink-0" role="banner" style={{
      background: 'var(--color-bg)',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div className="px-4 lg:px-6 py-0.5" style={{ minHeight: '3rem', display: 'flex', alignItems: 'center' }}>
        <div className="flex justify-between items-center w-full">
          {/* Logo */}
          <span
            onClick={handleLogoClick}
            className="header-logo font-medium hover:opacity-80 transition-opacity cursor-pointer"
            style={{
              textDecoration: 'none',
              fontSize: '1.125rem',
              lineHeight: '1.5',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexShrink: 0,
              color: 'var(--color-text-primary)',
            }}
          >
            <img
              src="/Sogni_Moon.svg"
              alt="Sogni"
              style={{ width: '24px', height: '24px', borderRadius: '50%' }}
            />
            <span className="header-logo-text" style={{ fontWeight: 600 }}>Sogni Chat</span>
          </span>

          <div className="flex items-center gap-3 header-buttons">
            {/* History link */}
            {isAuthenticated && (
              <nav className="header-nav flex items-center" style={{ fontSize: '0.875rem' }}>
                <button
                  onClick={() => navigate('/history')}
                  className="px-3 py-1.5 transition-colors"
                  style={{
                    fontWeight: 500,
                    color: 'var(--color-text-tertiary)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
                >
                  My Photos
                </button>
              </nav>
            )}

            <AuthStatus />
          </div>
        </div>
      </div>
    </header>
  );
}
