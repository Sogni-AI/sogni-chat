/**
 * Memory viewer slide-out panel — shows saved user preferences/facts.
 * 340px wide, slides in from right.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Memory } from '@/types/userData';

interface MemoryViewerProps {
  memories: Memory[];
  onDelete: (id: string) => Promise<void>;
  onAdd: (key: string, value: string) => Promise<void>;
  onClose: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

const SOURCE_LABELS: Record<string, string> = {
  user: 'Manual',
  llm: 'Conversation',
  onboarding: 'Onboarding',
};

const SOURCE_COLORS: Record<string, string> = {
  user: '#b4b4b4',
  llm: '#22C55E',
  onboarding: '#60a5fa',
};

export function MemoryViewer({ memories, onDelete, onAdd, onClose }: MemoryViewerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);

  // Close on Escape key (blur input first if focused)
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

  const handleAdd = useCallback(async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setAdding(true);
    try {
      await onAdd(newKey.trim(), newValue.trim());
      setNewKey('');
      setNewValue('');
    } catch (err) {
      console.error('[MEMORY VIEWER] Add failed:', err);
    } finally {
      setAdding(false);
    }
  }, [newKey, newValue, onAdd]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#ececec' }}>
              Your Memories
            </span>
            {memories.length > 0 && (
              <span style={{
                fontSize: '0.625rem', fontWeight: 600, background: 'rgba(255,255,255,0.08)',
                color: '#8e8e8e', borderRadius: '100px', padding: '2px 7px',
              }}>
                {memories.length}
              </span>
            )}
          </div>
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

        {/* Add memory input */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: '8px',
          flexShrink: 0,
        }}>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Key"
            style={{
              flex: 1, padding: '6px 10px', background: '#212121', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-md)', color: '#ececec', fontSize: '0.75rem', outline: 'none',
              minWidth: 0,
            }}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Value"
            style={{
              flex: 2, padding: '6px 10px', background: '#212121', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-md)', color: '#ececec', fontSize: '0.75rem', outline: 'none',
              minWidth: 0,
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!newKey.trim() || !newValue.trim() || adding}
            style={{
              padding: '6px 12px', background: '#ffffff', color: '#0a0a0a', border: 'none',
              borderRadius: 'var(--radius-md)', fontSize: '0.75rem', fontWeight: 600,
              cursor: (!newKey.trim() || !newValue.trim() || adding) ? 'not-allowed' : 'pointer',
              opacity: (!newKey.trim() || !newValue.trim() || adding) ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            Add
          </button>
        </div>

        {/* Memory list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {memories.length === 0 ? (
            <div style={{
              padding: '40px 20px', textAlign: 'center', color: '#666', fontSize: '0.8125rem', lineHeight: 1.6,
            }}>
              No memories yet. As you chat, your preferences will be remembered here.
            </div>
          ) : (
            memories.map(memory => (
              <div
                key={memory.id}
                style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  transition: 'background 0.1s',
                  background: hoveredId === memory.id ? 'rgba(255,255,255,0.03)' : 'transparent',
                  position: 'relative',
                }}
                onMouseEnter={() => setHoveredId(memory.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d4', marginBottom: '2px' }}>
                      {memory.key}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#ececec', lineHeight: 1.4 }}>
                      {memory.value}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.625rem', color: '#666' }}>
                        {formatRelativeTime(memory.updatedAt)}
                      </span>
                      <span style={{
                        fontSize: '0.5625rem', fontWeight: 600, color: SOURCE_COLORS[memory.source] || '#8e8e8e',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {SOURCE_LABELS[memory.source] || memory.source}
                      </span>
                    </div>
                  </div>
                  {/* Delete button — always visible (touch-friendly) but subtle */}
                  <button
                    onClick={() => onDelete(memory.id)}
                    style={{
                      width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                      flexShrink: 0, color: hoveredId === memory.id ? '#888' : '#444',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = hoveredId === memory.id ? '#888' : '#444'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
