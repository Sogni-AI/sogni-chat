/**
 * Sidebar section for personas — "My Personas" with avatar row.
 * Supports expanded (full row) and collapsed (icon stack) modes.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { PersonaSummary } from '@/types/userData';

/** Sort order: self first, partner second, then everyone else by updatedAt */
const RELATIONSHIP_ORDER: Record<string, number> = { self: 0, partner: 1 };

function sortPersonas(personas: PersonaSummary[]): PersonaSummary[] {
  return [...personas].sort((a, b) => {
    const oa = RELATIONSHIP_ORDER[a.relationship] ?? 2;
    const ob = RELATIONSHIP_ORDER[b.relationship] ?? 2;
    if (oa !== ob) return oa - ob;
    return b.updatedAt - a.updatedAt;
  });
}
import { PersonaAvatar } from './PersonaAvatar';
import { PersonaEmptyState } from './PersonaEmptyState';

interface PersonaSectionProps {
  personas: PersonaSummary[];
  collapsed: boolean;
  onAddPersona: () => void;
  onEditPersona: (id: string) => void;
  getThumbnailUrl: (personaId: string) => Promise<string | null>;
}

/** Info tooltip explaining the Personas feature */
function PersonaInfoTooltip() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="What are Personas?"
        style={{
          width: '14px', height: '14px', borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: 'none',
          border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
          color: '#8e8e8e', padding: 0, fontSize: '0.5625rem', fontWeight: 700,
          lineHeight: 1, transition: 'color 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; } }}
      >
        i
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '240px',
          padding: '10px 12px',
          background: '#2a2a2a',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 100,
          animation: 'menuFadeIn 0.15s ease-out',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d4', marginBottom: '4px' }}>
            What are Personas?
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#999', lineHeight: 1.5 }}>
            Personas teach your Creative Agent who you are and what you look like — and anyone else you want it to generate images, videos, and content with. All persona data is stored locally on your device.
          </div>
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            bottom: '-5px',
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: '8px',
            height: '8px',
            background: '#2a2a2a',
            borderRight: '1px solid rgba(255,255,255,0.12)',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
          }} />
        </div>
      )}
    </div>
  );
}

export function PersonaSection({
  personas,
  collapsed,
  onAddPersona,
  onEditPersona,
  getThumbnailUrl,
}: PersonaSectionProps) {
  const handleAvatarClick = useCallback((id: string) => {
    onEditPersona(id);
  }, [onEditPersona]);

  const sorted = useMemo(() => sortPersonas(personas), [personas]);

  // Collapsed: vertical stack of small avatars, max 3 + count badge
  if (collapsed) {
    const visible = sorted.slice(0, 3);
    const overflow = sorted.length - 3;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        padding: '8px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {visible.map(p => (
          <PersonaAvatar
            key={p.id}
            personaId={p.id}
            name={p.name}
            size="sm"
            getThumbnailUrl={getThumbnailUrl}
            updatedAt={p.updatedAt}
            onClick={() => handleAvatarClick(p.id)}
          />
        ))}
        {overflow > 0 && (
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem',
            fontWeight: 600, color: '#8e8e8e', background: 'rgba(255,255,255,0.06)',
          }}>
            +{overflow}
          </div>
        )}
        {/* Add button */}
        <button
          onClick={onAddPersona}
          title="Add person"
          style={{
            width: '28px', height: '28px', borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: 'none',
            border: '1px dashed rgba(255,255,255,0.15)', cursor: 'pointer', color: '#8e8e8e',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    );
  }

  // Expanded
  return (
    <div style={{
      padding: '0 0.75rem 0.5rem',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      marginTop: '0.5rem',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0 6px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#8e8e8e',
          }}>
            My Personas
          </span>
          <span style={{
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#00e5ff',
            background: 'rgba(0, 229, 255, 0.12)',
            padding: '1px 5px',
            borderRadius: '4px',
            lineHeight: '1.4',
          }}>
            New
          </span>
          <PersonaInfoTooltip />
        </div>
        <button
          onClick={onAddPersona}
          style={{
            fontSize: '0.6875rem', fontWeight: 500, color: '#b4b4b4', background: 'none',
            border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-sm)',
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#b4b4b4'; e.currentTarget.style.background = 'none'; }}
        >
          + Add
        </button>
      </div>

      {sorted.length === 0 ? (
        <PersonaEmptyState onAdd={onAddPersona} />
      ) : (
        /* Horizontal avatar row with fade hint */
        <div style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '4px',
          maskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent)',
          WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent)',
        }}>
          {sorted.map(p => (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
              <PersonaAvatar
                personaId={p.id}
                name={p.name}
                size="md"
                getThumbnailUrl={getThumbnailUrl}
                updatedAt={p.updatedAt}
                onClick={() => handleAvatarClick(p.id)}
              />
              <span style={{ fontSize: '0.625rem', color: '#8e8e8e', maxWidth: '44px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                {p.name}
              </span>
            </div>
          ))}
          {/* Dashed add circle */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
            <button
              onClick={onAddPersona}
              style={{
                width: '44px', height: '44px', borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', background: 'none',
                border: '2px dashed rgba(255,255,255,0.12)', cursor: 'pointer', color: '#666',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#b4b4b4'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <span style={{ fontSize: '0.625rem', color: 'transparent' }}>.</span>
          </div>
        </div>
      )}
    </div>
  );
}
