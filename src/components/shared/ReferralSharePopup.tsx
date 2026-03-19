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
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 100000,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        ref={panelRef}
        className="max-w-sm w-full relative overflow-hidden"
        style={{
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          background: '#2f2f2f',
          margin: '0 16px',
          animation: 'menuFadeIn 0.2s ease-out',
        }}
      >
        {/* Mascot header — same layout as Daily Boost */}
        <div style={{ position: 'relative' }}>
          <img
            src="/daily-boost-mascot.jpg"
            alt="Share & Earn"
            style={{
              width: '100%',
              height: '220px',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          {/* Gradient fade into card */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '80px',
            background: 'linear-gradient(to top, #2f2f2f, transparent)',
            pointerEvents: 'none',
          }} />
          {/* "Share & Earn" label */}
          <div style={{
            position: 'absolute',
            bottom: '12px',
            left: '0',
            right: '0',
            textAlign: 'center',
            pointerEvents: 'none',
          }}>
            <span
              id="referral-popup-title"
              style={{
                fontWeight: 700,
                fontSize: '1.25rem',
                color: '#ffffff',
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
                letterSpacing: '0.02em',
              }}
            >
              Share & Earn
            </span>
          </div>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(4px)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
          <ul
            style={{
              fontSize: '0.8125rem',
              lineHeight: 1.7,
              color: 'rgba(255, 255, 255, 0.6)',
              margin: '0 0 20px',
              paddingLeft: '20px',
              listStyleType: 'disc',
            }}
          >
            <li>
              Friends who sign up with your link get <strong style={{ color: '#00e5ff' }}>25 bonus credits</strong>.
            </li>
            <li>
              You earn <strong style={{ color: '#00e5ff' }}>25 credits</strong> after their first purchase.
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
              color: 'rgba(255, 255, 255, 0.4)',
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
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.06)',
                fontSize: '0.8125rem',
                color: 'rgba(255, 255, 255, 0.7)',
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
                background: copied ? '#10b981' : 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.12)',
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
                color: '#00e5ff',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              Learn about the Referral Program →
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
