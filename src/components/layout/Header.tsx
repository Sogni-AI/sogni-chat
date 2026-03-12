import { useCallback, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { useWallet } from '@/hooks/useWallet';
import { AuthStatus } from '@/components/auth/AuthStatus';
import { ReferralSharePopup } from '@/components/shared/ReferralSharePopup';

export function Header() {
  const { isAuthenticated } = useSogniAuth();
  const { balances, tokenType } = useWallet();
  const navigate = useNavigate();
  const location = useLocation();
  const [showReferral, setShowReferral] = useState(false);

  const handleLogoClick = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const currentBalance = balances?.[tokenType]?.net || '0';
  const balanceNum = parseFloat(currentBalance);

  return (
    <header className="flex-shrink-0" role="banner" style={{
      background: 'var(--color-bg-elevated)',
      boxShadow: 'var(--shadow-sm)'
    }}>
      <div className="px-4 lg:px-6 py-0.5" style={{ minHeight: '3.25rem', display: 'flex', alignItems: 'center' }}>
        <div className="flex justify-between items-center w-full">
          {/* Logo */}
          <span
            onClick={handleLogoClick}
            className="header-logo font-display text-sm font-bold gradient-accent hover:opacity-80 transition-opacity cursor-pointer"
            style={{
              letterSpacing: '-0.02em',
              textDecoration: 'none',
              fontSize: '1.375rem',
              lineHeight: '1.5',
              fontFamily: 'var(--font-display)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexShrink: 0,
            }}
          >
            <img
              src="/Sogni_Moon.svg"
              alt="Sogni"
              style={{ width: '28px', height: '28px', borderRadius: '50%' }}
            />
            <span className="header-logo-text">Sogni Chat</span>
          </span>

          <div className="flex items-center gap-3 header-buttons">
            {/* Nav links */}
            <nav className="header-nav flex items-center gap-1" style={{ fontSize: '0.875rem' }}>
              {isAuthenticated && (
                <>
                  <button
                    onClick={() => navigate('/')}
                    className="px-3 py-1.5 transition-colors"
                    style={{
                      fontWeight: location.pathname === '/' ? 600 : 500,
                      color: location.pathname === '/' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: location.pathname === '/' ? '2px solid var(--color-accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      borderRadius: 0,
                      paddingBottom: '0.25rem'
                    }}
                  >
                    AI Studio
                  </button>
                  <button
                    onClick={() => navigate('/history')}
                    className="px-3 py-1.5 transition-colors"
                    style={{
                      fontWeight: location.pathname === '/history' ? 600 : 500,
                      color: location.pathname === '/history' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: location.pathname === '/history' ? '2px solid var(--color-accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      borderRadius: 0,
                      paddingBottom: '0.25rem'
                    }}
                  >
                    My Photos
                  </button>
                </>
              )}
            </nav>

            {/* Credits badge */}
            {isAuthenticated && (
              <div
                className="header-credits-badge"
                style={{
                  background: 'var(--color-bg-parchment, var(--color-bg))',
                  border: '1px solid var(--color-border)',
                  borderRadius: '20px',
                  padding: '4px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap'
                }}
              >
                <span style={{ color: 'var(--color-accent)', fontSize: '0.8125rem' }}>&#9733;</span>
                <span>{balanceNum > 0 ? Math.round(balanceNum).toLocaleString() : '50 Free Daily'}</span>
                <span className="header-credits-label" style={{ color: 'var(--color-text-light)' }}>credits</span>
              </div>
            )}

            {/* Share / Referral button */}
            {isAuthenticated && (
              <button
                onClick={() => setShowReferral(true)}
                className="header-share-btn"
                style={{
                  background: 'linear-gradient(135deg, var(--sogni-pink), var(--sogni-purple))',
                  color: 'white',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(var(--rgb-accent), 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <span style={{ fontSize: '0.8125rem' }}>💰</span>
                <span>Share</span>
              </button>
            )}

            <AuthStatus />
          </div>
        </div>
      </div>

      <ReferralSharePopup isOpen={showReferral} onClose={() => setShowReferral(false)} />
    </header>
  );
}
