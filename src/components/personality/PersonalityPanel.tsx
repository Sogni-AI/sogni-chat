/**
 * Personality preference slide-out panel — lets users customize the LLM's personality.
 * 340px wide, slides in from right. Matches MemoryViewer visual style.
 */

import { useState, useEffect, useCallback } from 'react';

interface PersonalityPanelProps {
  personality: string;
  onSave: (instruction: string) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}

const MAX_CHARS = 500;

export function PersonalityPanel({ personality, onSave, onClear, onClose }: PersonalityPanelProps) {
  const [draft, setDraft] = useState(personality);
  const [saving, setSaving] = useState(false);

  // Sync draft when personality prop changes (e.g. cross-tab update)
  useEffect(() => {
    setDraft(personality);
  }, [personality]);

  // Close on Escape (blur textarea first, then close)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          (e.target as HTMLElement).blur();
          return;
        }
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } catch (err) {
      console.error('[PERSONALITY PANEL] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    try {
      await onClear();
      setDraft('');
    } catch (err) {
      console.error('[PERSONALITY PANEL] Reset failed:', err);
    } finally {
      setSaving(false);
    }
  }, [onClear]);

  const charCount = draft.length;
  const isOverLimit = charCount > MAX_CHARS;
  const hasChanges = draft.trim() !== personality;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(4px)',
          zIndex: 200,
          animation: 'backdropFadeIn 0.15s ease',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '340px',
          maxWidth: '100vw',
          height: '100%',
          background: '#171717',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInFromRight 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#ececec' }}>
            Personality
          </span>
          <button
            onClick={onClose}
            style={{
              width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: '#8e8e8e',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.background = 'none'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ fontSize: '0.75rem', color: '#8e8e8e', lineHeight: 1.5, margin: 0 }}>
            Describe how you'd like the AI to talk to you. This changes the assistant's tone and style across all conversations.
          </p>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Be concise and professional, skip the small talk"
            style={{
              width: '100%',
              minHeight: '140px',
              padding: '12px',
              background: '#212121',
              border: `1px solid ${isOverLimit ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 'var(--radius-md)',
              color: '#ececec',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = isOverLimit ? 'rgba(245, 158, 11, 0.6)' : 'rgba(255,255,255,0.2)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = isOverLimit ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255,255,255,0.1)'; }}
          />

          {/* Character counter */}
          <div style={{
            fontSize: '0.6875rem',
            color: isOverLimit ? '#f59e0b' : '#666',
            textAlign: 'right',
            marginTop: '-8px',
          }}>
            {charCount} / {MAX_CHARS}
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={handleSave}
              disabled={!draft.trim() || saving || !hasChanges}
              style={{
                flex: 1,
                padding: '8px 16px',
                background: '#ffffff',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: (!draft.trim() || saving || !hasChanges) ? 'not-allowed' : 'pointer',
                opacity: (!draft.trim() || saving || !hasChanges) ? 0.4 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>

            {personality && (
              <button
                onClick={handleReset}
                disabled={saving}
                style={{
                  padding: '8px 16px',
                  background: 'none',
                  color: '#8e8e8e',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#d4d4d4'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
