import { useEffect, useRef } from 'react';
import { ContentPanel, FormContent, FormFooter } from '../common';
import { useSogniAuth } from '../../../../services/sogniAuth';

interface Props {
  onClose: () => void;
  onSignupComplete?: () => void;
}

function Step4({ onClose, onSignupComplete }: Props) {
  const { user, isAuthenticated } = useSogniAuth();
  const hasTriggeredCallback = useRef(false);

  useEffect(() => {
    if (isAuthenticated && user && !hasTriggeredCallback.current) {
      hasTriggeredCallback.current = true;

      const timer = setTimeout(() => {
        onClose();

        if (onSignupComplete) {
          setTimeout(() => {
            onSignupComplete();
          }, 100);
        }
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, user, onClose, onSignupComplete]);

  return (
    <ContentPanel>
      <FormContent
        noHeading
        subHeading={
          <>
            Welcome, <span className="font-bold gradient-accent">@{user?.username}</span>!
          </>
        }
      >
        <div className="text-center py-6">
          {/* Success Icon */}
          <div
            className="w-20 h-20 mx-auto mb-4 flex items-center justify-center rounded-full"
            style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(34, 197, 94, 0.2) 100%)',
              border: '2px solid rgba(34, 197, 94, 0.3)'
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Account Created Successfully!
          </h3>
          <p
            className="mb-4"
            style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem' }}
          >
            Check your email to verify your account and claim free credits.
          </p>
          {/* Bonus badge */}
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full"
            style={{
              background: 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.05) 0%, rgba(var(--rgb-accent), 0.15) 100%)',
              border: '1px solid rgba(var(--rgb-primary), 0.1)'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ececec" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.875rem' }}>
              50 FREE Daily Credits!
            </span>
          </div>
        </div>
      </FormContent>
      <FormFooter>
        <button
          type="button"
          className="w-full py-3 px-4 rounded-xl font-semibold transition-all hover:scale-[1.02]"
          style={{
            background: '#ffffff',
            color: '#0a0a0a',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)'
          }}
          onClick={onClose}
        >
          Get Started
        </button>
      </FormFooter>
    </ContentPanel>
  );
}

export default Step4;
