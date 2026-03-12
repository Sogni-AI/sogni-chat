/**
 * Inline chat-bubble indicator shown while vision analysis is in progress.
 * Displays a spinning accent dot + rotating step messages that crossfade.
 */
import { useState, useEffect } from 'react';

const RESTORATION_STEPS = [
  'Examining your photo...',
  'Looking for damage...',
  'Checking colors and detail...',
  'Preparing suggestions...',
];

const VIDEO_STEPS = [
  'Examining your photo...',
  'Analyzing movement potential...',
  'Identifying cinematic elements...',
  'Crafting animation ideas...',
];

const ROTATE_INTERVAL_MS = 2500;

interface ChatAnalysisIndicatorProps {
  intent?: 'edit' | 'video' | 'restore' | null;
}

export function ChatAnalysisIndicator({ intent }: ChatAnalysisIndicatorProps) {
  const steps = intent === 'video' ? VIDEO_STEPS : RESTORATION_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  // Rotate step messages
  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      // After fade-out, swap text and fade back in
      setTimeout(() => {
        setStepIndex((prev) => (prev + 1) % steps.length);
        setVisible(true);
      }, 250);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: '100%',
        animation: 'chipsFadeIn 0.3s ease-out',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '0.75rem 1rem',
          borderRadius: '1rem 1rem 1rem 0.25rem',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
        }}
      >
        {/* Spinning accent dot */}
        <div
          className="animate-spin"
          style={{
            width: '0.875rem',
            height: '0.875rem',
            border: '2px solid var(--color-border)',
            borderTopColor: 'var(--color-accent)',
            borderRadius: '50%',
            flexShrink: 0,
          }}
        />

        {/* Rotating step text with crossfade */}
        <span
          style={{
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            fontStyle: 'italic',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.25s ease',
            whiteSpace: 'nowrap',
          }}
          aria-live="polite"
        >
          {steps[stepIndex]}
        </span>
      </div>
    </div>
  );
}
