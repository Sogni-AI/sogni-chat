import React, { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LoginModalMode } from './types';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';
import { defaultModalText, ModalContextProvider, ModalText } from './context';

interface Props {
  open: boolean;
  mode: LoginModalMode;
  onModeChange: (mode: LoginModalMode) => void;
  onClose: () => void;
  textOverrides?: Partial<ModalText>;
  onSignupComplete?: () => void;
}

const emptyObject = {};

function LoginModal({ open, mode, onModeChange, onClose, textOverrides = emptyObject, onSignupComplete }: Props) {
  const modalCtx = useMemo(
    () => ({
      text: { ...defaultModalText, ...textOverrides }
    }),
    [textOverrides]
  );

  const handleLogin = useCallback(() => onModeChange('login'), [onModeChange]);
  const handleSignup = useCallback(() => onModeChange('signup'), [onModeChange]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!open) return null;

  let content;
  switch (mode) {
    case 'login':
      content = <LoginForm onSignup={handleSignup} onClose={onClose} />;
      break;
    case 'signup':
      content = <SignupForm onLogin={handleLogin} onClose={onClose} onSignupComplete={onSignupComplete} />;
      break;
    default:
      content = null;
  }

  const modalContent = (
    <ModalContextProvider value={modalCtx}>
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{
          zIndex: 100000,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)'
        }}
        onClick={handleOverlayClick}
      >
        <div
          className="bg-white max-w-md w-full max-h-[90vh] overflow-y-auto relative"
          style={{
            borderRadius: 'var(--radius-xl, 16px)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full transition-colors z-10"
            style={{
              background: 'rgba(0, 0, 0, 0.05)',
              color: 'var(--color-text-secondary)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
            }}
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className="p-4">{content}</div>
        </div>
      </div>
    </ModalContextProvider>
  );

  return createPortal(modalContent, document.body);
}

export default LoginModal;
export type { LoginModalMode } from './types';
