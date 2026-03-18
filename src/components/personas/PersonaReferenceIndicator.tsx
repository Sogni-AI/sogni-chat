/**
 * Small indicator shown during generation when personas are being referenced.
 * Displays "Including: [initials] Name, [initials] Name" row.
 */

interface PersonaReferenceIndicatorProps {
  personaNames: string[];
}

/** Deterministic color from a name string — picks from a small palette. */
function nameColor(name: string): string {
  const palette = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

/** First letter of first and last word, uppercased. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PersonaReferenceIndicator({
  personaNames,
}: PersonaReferenceIndicatorProps) {
  if (personaNames.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 0',
      fontSize: '0.6875rem',
      color: '#8e8e8e',
    }}>
      <span>Including:</span>
      {personaNames.map((name) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: nameColor(name),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.5625rem',
              fontWeight: 600,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {initials(name)}
          </div>
          <span style={{ fontSize: '0.625rem', color: '#b4b4b4' }}>{name}</span>
        </div>
      ))}
    </div>
  );
}
