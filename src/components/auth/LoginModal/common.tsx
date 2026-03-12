import React, { ReactNode } from 'react';
import { useModalCtx } from './context';

interface Props {
  children: ReactNode;
}

export function ContentPanel({ children }: Props) {
  return <div className="p-6">{children}</div>;
}

interface FormPanelProps extends Props {
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  disabled?: boolean;
  autoComplete?: string;
  noValidate?: boolean;
}

export function FormPanel({ children, onSubmit, disabled, autoComplete, noValidate }: FormPanelProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="p-2"
      autoComplete={autoComplete}
      noValidate={noValidate}
    >
      <fieldset disabled={disabled} className="border-none p-0 m-0">
        {children}
      </fieldset>
    </form>
  );
}

interface FormContentProps extends Props {
  noHeading?: boolean;
  subHeading?: ReactNode;
}

export function FormContent({ children, noHeading, subHeading }: FormContentProps) {
  const { text } = useModalCtx();
  return (
    <div>
      {/* Header with gradient background */}
      <div
        className="text-center mb-6 -mx-2 -mt-2 px-6 py-6 rounded-t-lg"
        style={{
          background: 'linear-gradient(135deg, rgba(var(--rgb-primary), 0.03) 0%, rgba(var(--rgb-accent), 0.12) 100%)',
          borderBottom: '1px solid rgba(var(--rgb-primary), 0.08)'
        }}
      >
        {/* Icon */}
        {!noHeading && (
          <div
            className="w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-full"
            style={{
              background: 'linear-gradient(135deg, var(--sogni-pink), var(--sogni-purple))',
              boxShadow: '0 4px 14px rgba(var(--rgb-accent), 0.4)'
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4V2" />
              <path d="M15 16v-2" />
              <path d="M8 9h2" />
              <path d="M20 9h2" />
              <path d="M17.8 11.8L19 13" />
              <path d="M15 9h0" />
              <path d="M17.8 6.2L19 5" />
              <path d="M3 21l9-9" />
              <path d="M12.2 6.2L11 5" />
            </svg>
          </div>
        )}
        {!noHeading && (
          <h1
            className="text-xl font-bold mb-1"
            style={{
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em'
            }}
          >
            {text.heading}
          </h1>
        )}
        {subHeading && (
          <h2
            className="text-sm font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {subHeading}
          </h2>
        )}
        {/* Free credits badge */}
        {!noHeading && (
          <div
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: 'linear-gradient(135deg, var(--sogni-pink), var(--sogni-purple))',
              color: 'white',
              boxShadow: '0 2px 8px rgba(var(--rgb-accent), 0.3)'
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
            <span>50 Free Credits Daily</span>
          </div>
        )}
      </div>
      <div className="px-2">
        {children}
      </div>
    </div>
  );
}

export function FieldContainer({ children }: Props) {
  return <div className="space-y-4">{children}</div>;
}

export function FormFooter({ children }: Props) {
  return <div className="mt-6 text-center px-2 pb-2">{children}</div>;
}

export function ErrorMessage({ children }: Props) {
  return (
    <div
      className="px-4 py-3 rounded-lg mb-4 text-sm"
      style={{
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        color: '#dc2626'
      }}
    >
      {children}
    </div>
  );
}

interface LinkButtonProps extends Props {
  onClick: () => void;
}

export function LinkButton({ children, onClick }: LinkButtonProps) {
  return (
    <button
      className="font-medium hover:underline transition-colors"
      style={{ color: 'var(--sogni-purple)' }}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
