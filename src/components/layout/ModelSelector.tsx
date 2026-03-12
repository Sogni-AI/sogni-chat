/**
 * Model variant dropdown — ChatGPT-style dropdown next to the logo.
 * Shows "Sogni Creative Agent 1.0 [variant]" with chevron; opens dropdown on click.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { MODEL_VARIANTS, type ModelVariant } from '@/config/modelVariants';

interface ModelSelectorProps {
  selectedVariantId: string;
  onSelectVariant: (variantId: string) => void;
}

export function ModelSelector({ selectedVariantId, onSelectVariant }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = MODEL_VARIANTS.find(v => v.id === selectedVariantId) ?? MODEL_VARIANTS[0];

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleSelect = useCallback((variant: ModelVariant) => {
    onSelectVariant(variant.id);
    setOpen(false);
  }, [onSelectVariant]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '0.25rem 0.5rem',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-primary)',
          fontSize: '1.125rem',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          transition: 'background 0.15s',
          outline: 'none',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <img
          src="/Sogni_moon_2026.png"
          alt="Sogni"
          className="model-selector-ball"
          style={{ width: 28, height: 28, objectFit: 'cover', objectPosition: 'left center', display: 'none' }}
        />
        <span className="model-selector-text">Sogni Creative Agent 1.0</span>
        {selected.headerSuffix && (
          <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            {selected.headerSuffix}
          </span>
        )}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            opacity: 0.5,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '260px',
            background: '#2f2f2f',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 100,
            padding: '0.5rem 0',
            animation: 'dropdownFadeIn 0.12s ease-out',
          }}
        >
          <div style={{
            padding: '0.375rem 1rem 0.5rem',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: '#8e8e8e',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Model
          </div>

          {MODEL_VARIANTS.map((variant) => (
            <button
              key={variant.id}
              onClick={() => handleSelect(variant)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '0.5rem 1rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--color-text-primary)',
                transition: 'background 0.1s',
                outline: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div>
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}>
                  {variant.menuLabel}
                </div>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#8e8e8e',
                  lineHeight: 1.4,
                }}>
                  {variant.description}
                </div>
              </div>
              {variant.id === selectedVariantId && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#ececec' }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
