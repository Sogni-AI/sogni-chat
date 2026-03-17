import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSogniAuth } from '@/services/sogniAuth';

interface ReferralSharePopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReferralSharePopup({ isOpen, onClose }: ReferralSharePopupProps) {
  const { user } = useSogniAuth();
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const referralUrl = user?.username
    ? `https://chat.sogni.ai/?code=${encodeURIComponent(user.username)}`
    : '';

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const handleCopy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[REFERRAL] Failed to copy:', err);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="referral-popup-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        ref={panelRef}
        style={{
          background: 'var(--color-bg-elevated)',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '420px',
          margin: '0 16px',
          boxShadow: '0 20px 60px rgba(var(--rgb-dark-navy), 0.2)',
          overflow: 'hidden',
          animation: 'menuFadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 24px 20px',
            background: 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.08), rgba(var(--rgb-accent), 0.06))',
            borderBottom: '1px solid var(--color-border-light)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✨</div>
          <h2
            id="referral-popup-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 700,
              color: 'var(--color-primary)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Share & Earn
          </h2>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          <ul
            style={{
              fontSize: '0.8125rem',
              lineHeight: 1.7,
              color: 'var(--color-text-secondary)',
              margin: '0 0 20px',
              paddingLeft: '20px',
              listStyleType: 'disc',
            }}
          >
            <li>
              Friends who sign up with your link get <strong style={{ color: 'var(--color-accent)' }}>25 bonus credits</strong>.
            </li>
            <li>
              You earn <strong style={{ color: 'var(--color-accent)' }}>25 credits</strong> after their first purchase.
            </li>
            <li>
              You also earn a share of rewards on every credit purchase they make — or that their own referrals make.
            </li>
          </ul>

          {/* Referral link */}
          <label
            style={{
              display: 'block',
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-text-light)',
              marginBottom: '6px',
            }}
          >
            Your referral link
          </label>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'stretch',
            }}
          >
            <input
              type="text"
              readOnly
              value={referralUrl}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-parchment, var(--color-bg))',
                fontSize: '0.8125rem',
                color: 'var(--color-text-secondary)',
                outline: 'none',
                minWidth: 0,
              }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={handleCopy}
              style={{
                padding: '10px 16px',
                borderRadius: '10px',
                background: copied ? '#10b981' : 'var(--color-bg-hover)',
                color: copied ? 'white' : 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Leaderboard link */}
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <a
              href="https://docs.sogni.ai/rewards/referral-program-sogni-ambassador-rewards"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--color-primary)',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              Learn about the Referral Program →
            </a>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 24px 16px',
            textAlign: 'center',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 24px',
              borderRadius: '10px',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--color-text-light)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(var(--rgb-primary), 0.04)';
              e.currentTarget.style.borderColor = 'var(--color-border-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'var(--color-border)';
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
