/**
 * Empty state CTA card shown in sidebar when no personas exist.
 */

interface PersonaEmptyStateProps {
  onAdd: () => void;
}

export function PersonaEmptyState({ onAdd }: PersonaEmptyStateProps) {
  return (
    <button
      onClick={onAdd}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px dashed rgba(255,255,255,0.12)',
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
      }}
    >
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d4', marginBottom: '2px' }}>
        Add yourself
      </div>
      <div style={{ fontSize: '0.6875rem', color: '#8e8e8e', lineHeight: 1.4 }}>
        So I can include you in creations
      </div>
    </button>
  );
}
