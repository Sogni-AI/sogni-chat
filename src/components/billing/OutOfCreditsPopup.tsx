import React, { useRef, useEffect, useState } from 'react';
import { PackPurchaseModal } from './PackPurchaseModal';

interface OutOfCreditsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchase?: () => void;
  onSwitchPayment?: () => void;
}

export const OutOfCreditsPopup: React.FC<OutOfCreditsPopupProps> = ({ isOpen, onClose, onSwitchPayment }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [showPackModal, setShowPackModal] = useState(false);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleGetCreditsClick = () => {
    setShowPackModal(true);
    onClose();
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen && !showPackModal) return null;

  return (
    <>
      {isOpen && (
        <div
          ref={overlayRef}
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: 100000, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={handleOverlayClick}
        >
          <div
            ref={modalRef}
            style={{
              background: 'white',
              borderRadius: '20px',
              maxWidth: '420px',
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.2), 0 0 40px rgba(var(--rgb-accent), 0.15)',
              animation: 'popupSlideIn 0.3s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient header */}
            <div style={{
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              padding: '28px 24px 22px',
              textAlign: 'center',
              position: 'relative',
            }}>
              <div style={{
                position: 'relative',
                width: '80px',
                height: '50px',
                margin: '0 auto 14px',
              }}>
                <div style={{
                  position: 'absolute',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.12)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  left: '0',
                  top: '3px',
                }} />
                <div style={{
                  position: 'absolute',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.18)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  left: '22px',
                  top: '0',
                }} />
                <div style={{
                  position: 'absolute',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  left: '48px',
                  top: '10px',
                }} />
              </div>
              <h2 style={{
                color: 'white',
                fontSize: '1.25rem',
                fontWeight: 700,
                marginBottom: '4px',
              }}>
                Out of Credits
              </h2>
              <p style={{
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: '0.8125rem',
              }}>
                Top up your credits or switch payment methods to continue.
              </p>
            </div>

            {/* Clickable option cards */}
            <div style={{ padding: '20px 24px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Buy Spark Points */}
                <button
                  onClick={handleGetCreditsClick}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '14px 16px',
                    background: 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.04), rgba(var(--rgb-accent), 0.08))',
                    border: '1px solid rgba(var(--rgb-accent), 0.3)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.08), rgba(var(--rgb-accent), 0.15))';
                    e.currentTarget.style.borderColor = 'rgba(var(--rgb-accent), 0.5)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(var(--rgb-primary), 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.04), rgba(var(--rgb-accent), 0.08))';
                    e.currentTarget.style.borderColor = 'rgba(var(--rgb-accent), 0.3)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    width: '36px',
                    height: '36px',
                    background: 'var(--sogni-gradient)',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      Buy Spark Points
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)', marginTop: '1px' }}>
                      Purchase credits to continue restoring
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Switch payment method */}
                <button
                  onClick={onSwitchPayment || onClose}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '14px 16px',
                    background: 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.04), rgba(var(--rgb-accent), 0.08))',
                    border: '1px solid rgba(var(--rgb-accent), 0.3)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.08), rgba(var(--rgb-accent), 0.15))';
                    e.currentTarget.style.borderColor = 'rgba(var(--rgb-accent), 0.5)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(var(--rgb-primary), 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.04), rgba(var(--rgb-accent), 0.08))';
                    e.currentTarget.style.borderColor = 'rgba(var(--rgb-accent), 0.3)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    width: '36px',
                    height: '36px',
                    background: 'var(--sogni-gradient)',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="17 1 21 5 17 9" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <polyline points="7 23 3 19 7 15" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      Switch payment method
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)', marginTop: '1px' }}>
                      Change via the profile menu
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>

            <style>{`@keyframes popupSlideIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
          </div>
        </div>
      )}

      <PackPurchaseModal
        isOpen={showPackModal}
        onClose={() => setShowPackModal(false)}
      />
    </>
  );
};
