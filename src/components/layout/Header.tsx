/**
 * Header bar — sits at the top of the main content area (right of sidebar).
 * Contains: model selector dropdown + nav + share button + auth status.
 */
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { AuthStatus } from '@/components/auth/AuthStatus';
import { ReferralSharePopup } from '@/components/shared/ReferralSharePopup';
import { ModelSelector } from './ModelSelector';

interface HeaderProps {
  selectedModelVariant: string;
  onSelectModelVariant: (variantId: string) => void;
}

export function Header({ selectedModelVariant, onSelectModelVariant }: HeaderProps) {
  const { isAuthenticated } = useSogniAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onHistoryPage = location.pathname === '/history';
  const [showReferral, setShowReferral] = useState(false);

  return (
    <header className="flex-shrink-0" role="banner" style={{
      background: 'var(--color-bg)',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div className="px-4 lg:px-6 py-0.5" style={{ minHeight: '3rem', display: 'flex', alignItems: 'center' }}>
        <div className="flex justify-between items-center w-full">
          {/* Model selector dropdown */}
          <ModelSelector
            selectedVariantId={selectedModelVariant}
            onSelectVariant={onSelectModelVariant}
          />

          <div className="flex items-center gap-3 header-buttons">
            {/* History link */}
            {isAuthenticated && (
              <nav className="header-nav flex items-center" style={{ fontSize: '0.875rem' }}>
                <button
                  onClick={() => navigate(onHistoryPage ? '/' : '/history')}
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
                  {onHistoryPage ? '← Chat' : 'My Media'}
                </button>
              </nav>
            )}

            {/* Share / Referral button */}
            {isAuthenticated && (
              <button
                onClick={() => setShowReferral(true)}
                className="header-share-btn"
                style={{
                  background: 'transparent',
                  color: 'var(--color-text-tertiary)',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'color 0.15s ease',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
              >
                ✨ Share
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
