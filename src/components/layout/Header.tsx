/**
 * Header bar — sits at the top of the main content area (right of sidebar).
 * Contains: model selector dropdown + nav + auth status.
 */
import { useNavigate } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { AuthStatus } from '@/components/auth/AuthStatus';
import { ModelSelector } from './ModelSelector';

interface HeaderProps {
  selectedModelVariant: string;
  onSelectModelVariant: (variantId: string) => void;
}

export function Header({ selectedModelVariant, onSelectModelVariant }: HeaderProps) {
  const { isAuthenticated } = useSogniAuth();
  const navigate = useNavigate();

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
