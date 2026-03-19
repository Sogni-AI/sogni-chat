/**
 * Sidebar section for personas — "My Personas" with avatar row.
 * Supports expanded (full row) and collapsed (icon stack) modes.
 */

import { useCallback, useMemo } from 'react';
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
        <span style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#8e8e8e',
        }}>
          My Personas
        </span>
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
