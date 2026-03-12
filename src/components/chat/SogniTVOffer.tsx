/**
 * Inline chat offer to watch SogniTV while media is rendering.
 * Shows once per tool execution. Respects "Don't Ask Me Again" preference.
 */
import { useState, useEffect, useRef } from 'react';
import { sogniTVController } from '@/services/sogniTVController';

const DONT_ASK_KEY = 'sogni-tv-dont-ask';

/** Minimum initial ETA (seconds) before showing the offer */
const MIN_INITIAL_ETA = 20;
/** Hide offer once remaining time drops to this (seconds) */
const MIN_REMAINING_ETA = 12;

interface SogniTVOfferProps {
  /** Unique ID for this tool execution (e.g. message ID) to show offer only once per run */
  executionId: string;
  /** Current ETA in seconds from tool progress (undefined if not yet estimated) */
  etaSeconds?: number;
}

// Track which executions have already shown the offer (session-scoped)
const shownOffers = new Set<string>();

export function SogniTVOffer({ executionId, etaSeconds }: SogniTVOfferProps) {
  const [visible, setVisible] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // Track whether the initial ETA threshold was met for this execution
  const qualifiedRef = useRef(false);

  // Show once an ETA arrives that exceeds the initial threshold
  useEffect(() => {
    if (shownOffers.has(executionId)) return;
    if (localStorage.getItem(DONT_ASK_KEY)) return;
    if (etaSeconds == null) return; // no estimate yet
    if (qualifiedRef.current) return; // already shown

    if (etaSeconds > MIN_INITIAL_ETA) {
      qualifiedRef.current = true;
      shownOffers.add(executionId);
      setVisible(true);
    }
  }, [executionId, etaSeconds]);

  // Hide once remaining time drops below threshold
  useEffect(() => {
    if (!visible || accepted) return;
    if (etaSeconds != null && etaSeconds <= MIN_REMAINING_ETA) {
      setVisible(false);
    }
  }, [etaSeconds, visible, accepted]);

  if (!visible || accepted) return null;

  const handleYes = () => {
    setAccepted(true);
    sogniTVController.open(true);
  };

  const handleNo = () => {
    setVisible(false);
  };

  const handleDontAsk = () => {
    localStorage.setItem(DONT_ASK_KEY, 'true');
    setVisible(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(139, 92, 246, 0.08)',
        border: '1px solid rgba(139, 92, 246, 0.2)',
        marginTop: 8,
        animation: 'sogniTvOfferIn 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes sogniTvOfferIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <span style={{
        fontSize: '0.8125rem',
        color: '#c4b5fd',
        lineHeight: 1.4,
      }}>
        Want to watch some SogniTV while your media is rendering? We'll automatically turn the TV off when ready!
      </span>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={handleYes}
          style={{
            padding: '5px 14px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: '#8b5cf6',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#a78bfa'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = '#8b5cf6'; }}
        >
          Yes
        </button>
        <button
          onClick={handleNo}
          style={{
            padding: '5px 14px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: '#a1a1aa',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
        >
          No
        </button>
        <button
          onClick={handleDontAsk}
          style={{
            padding: '5px 14px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: 'transparent',
            color: '#71717a',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#a1a1aa'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#71717a'; }}
        >
          Don't Ask Me Again
        </button>
      </div>
    </div>
  );
}
