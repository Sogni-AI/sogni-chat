import { useState, useRef, useEffect } from 'react';

interface DisableContentFilterPopupProps {
  isOpen: boolean;
  onConfirm: (permanent: boolean) => void;
  onCancel: () => void;
}

function DisableContentFilterPopup({ isOpen, onConfirm, onCancel }: DisableContentFilterPopupProps) {
  const [ageAccepted, setAgeAccepted] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset toggles when popup opens
  useEffect(() => {
    if (isOpen) {
      setAgeAccepted(false);
      setPermanent(false);
    }
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 100000, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        style={{
          background: '#2f2f2f',
          borderRadius: '20px',
          maxWidth: '440px',
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.2), 0 0 40px rgba(255, 255, 255, 0.05)',
          animation: 'popupSlideIn 0.3s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: '#171717',
          padding: '24px 24px 20px',
          position: 'relative',
        }}>
          {/* Close button */}
          <button
            onClick={onCancel}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8e8e8e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <h2 style={{
            color: '#ececec',
            fontSize: '1.25rem',
            fontWeight: 700,
            marginBottom: '0',
          }}>
            Disable Safe Content Filter
          </h2>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px' }}>
          {/* Warning text */}
          <p style={{
            color: '#b4b4b4',
            fontSize: '0.8125rem',
            lineHeight: 1.6,
            margin: '0 0 12px',
          }}>
            Please ensure that you are at least 18 years old and that you agree to{' '}
            <a
              href="https://sogni.ai/terms"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#60a5fa',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
            >
              Sogni Terms &amp; Conditions
            </a>.
          </p>

          <p style={{
            color: '#b4b4b4',
            fontSize: '0.8125rem',
            lineHeight: 1.6,
            margin: '0 0 24px',
          }}>
            Additionally, refrain from exposing unfiltered results to the public.
            Disabling the safe content filter may lead to the display of undesirable
            content that could be disturbing to viewers.
          </p>

          {/* Toggle 1: Age & Terms */}
          <button
            onClick={() => setAgeAccepted(!ageAccepted)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              padding: '12px 14px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: '10px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; }}
          >
            <div style={{
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              background: ageAccepted ? '#4f8f4f' : '#555',
              position: 'relative',
              transition: 'background 0.2s ease',
              flexShrink: 0,
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: '2px',
                left: ageAccepted ? '18px' : '2px',
                transition: 'left 0.2s ease',
              }} />
            </div>
            <span style={{
              fontSize: '0.8125rem',
              color: '#d4d4d4',
              lineHeight: 1.4,
            }}>
              I'm over 18 years old and have read and accepted Sogni's Terms &amp; Conditions.
            </span>
          </button>

          {/* Toggle 2: Permanent */}
          <button
            onClick={() => setPermanent(!permanent)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              padding: '12px 14px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: '24px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; }}
          >
            <div style={{
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              background: permanent ? '#4f8f4f' : '#555',
              position: 'relative',
              transition: 'background 0.2s ease',
              flexShrink: 0,
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: '2px',
                left: permanent ? '18px' : '2px',
                transition: 'left 0.2s ease',
              }} />
            </div>
            <span style={{
              fontSize: '0.8125rem',
              color: '#d4d4d4',
              lineHeight: 1.4,
            }}>
              Leave Safe Content Filter off permanently
            </span>
          </button>

          {/* Continue button */}
          <button
            onClick={() => onConfirm(permanent)}
            disabled={!ageAccepted}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '12px 20px',
              background: ageAccepted ? '#ffffff' : 'rgba(255, 255, 255, 0.08)',
              color: ageAccepted ? '#0a0a0a' : '#666',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: ageAccepted ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              opacity: ageAccepted ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (ageAccepted) {
                e.currentTarget.style.background = '#e0e0e0';
              }
            }}
            onMouseLeave={(e) => {
              if (ageAccepted) {
                e.currentTarget.style.background = '#ffffff';
              }
            }}
          >
            {/* Eye icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Continue
          </button>
        </div>

        <style>{`@keyframes popupSlideIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
      </div>
    </div>
  );
}

export default DisableContentFilterPopup;
