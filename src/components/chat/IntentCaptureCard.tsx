/**
 * Visual intent capture card for guided onboarding.
 * Users select damage types and optionally add context,
 * then a synthesized message is sent to the LLM.
 */
import { useState, useCallback } from 'react';
import {
  DAMAGE_OPTIONS,
  QUICK_RESTORE_MESSAGE,
  synthesizeIntentMessage,
} from '@/config/chatIntentOptions';

interface IntentCaptureCardProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
}

export function IntentCaptureCard({ onSubmit, disabled }: IntentCaptureCardProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [additionalContext, setAdditionalContext] = useState('');

  const toggleOption = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const message = synthesizeIntentMessage([...selectedIds], additionalContext);
    onSubmit(message);
  }, [selectedIds, additionalContext, onSubmit]);

  const handleQuickRestore = useCallback(() => {
    onSubmit(QUICK_RESTORE_MESSAGE);
  }, [onSubmit]);

  return (
    <div
      className="intent-capture-card"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '1.25rem',
        animation: 'chipsFadeIn 0.3s ease-out',
      }}
    >
      <p
        style={{
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-display)',
          marginBottom: '0.875rem',
        }}
      >
        What would you like to do?
      </p>

      {/* Damage type checkboxes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        {DAMAGE_OPTIONS.map((opt) => {
          const isSelected = selectedIds.has(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleOption(opt.id)}
              disabled={disabled}
              className="intent-option-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                fontFamily: 'var(--font-body)',
                color: isSelected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                background: isSelected
                  ? 'rgba(var(--rgb-accent), 0.08)'
                  : 'rgba(var(--rgb-primary), 0.03)',
                border: isSelected
                  ? '1px solid rgba(var(--rgb-accent), 0.3)'
                  : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
            >
              {/* Checkbox indicator */}
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.125rem',
                  height: '1.125rem',
                  borderRadius: '0.25rem',
                  border: isSelected
                    ? '2px solid var(--color-accent)'
                    : '2px solid var(--color-border)',
                  background: isSelected ? '#ececec' : 'transparent',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              >
                {isSelected && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6L5 8.5L9.5 3.5"
                      stroke="#0a0a0a"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Optional context */}
      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          placeholder="Anything else? (optional)"
          disabled={disabled}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            fontSize: '0.8125rem',
            fontFamily: 'var(--font-body)',
            color: 'var(--color-text-primary)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            transition: 'border-color 0.2s',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && selectedIds.size > 0) handleSubmit();
          }}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          onClick={handleSubmit}
          disabled={disabled || selectedIds.size === 0}
          style={{
            padding: '0.5625rem 1.25rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            color: '#0a0a0a',
            background: selectedIds.size > 0
              ? '#ffffff'
              : 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            cursor: disabled || selectedIds.size === 0 ? 'default' : 'pointer',
            opacity: disabled || selectedIds.size === 0 ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          Start Editing
        </button>
        <button
          onClick={handleQuickRestore}
          disabled={disabled}
          style={{
            padding: '0.5625rem 0',
            fontSize: '0.8125rem',
            fontWeight: 500,
            fontFamily: 'var(--font-body)',
            color: 'var(--color-text-secondary)',
            background: 'none',
            border: 'none',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'color 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          Just do a quick restore &rarr;
        </button>
      </div>
    </div>
  );
}
