/**
 * Authentication status indicator for the header — dark theme.
 * Dropdown menu with wallet balance, payment method toggle, buy credits,
 * billing history, safe content filter, and sign out.
 */

import { useState, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useSogniAuth } from '@/services/sogniAuth';
import { useLayout } from '@/layouts/AppLayout';
import { useWallet } from '@/hooks/useWallet';
import { useTokenPrice } from '@/hooks/useTokenPrice';
import { formatTokenAmount, getTokenLabel } from '@/services/walletService';
import type { TokenType } from '@/types/wallet';
import { PackPurchaseModal } from '@/components/billing/PackPurchaseModal';
import BillingHistoryModal from '@/components/billing/BillingHistoryModal';
import { MemoryViewer } from '@/components/personas/MemoryViewer';
import { useMemories } from '@/hooks/useMemories';
import { PersonalityPanel } from '@/components/personality/PersonalityPanel';
import { usePersonality } from '@/hooks/usePersonality';

export function AuthStatus() {
  const { isAuthenticated, isLoading, user, authMode, logout } = useSogniAuth();
  const { showSignupModal, safeContentFilter, setSafeContentFilter, requestDisableContentFilter } = useLayout();
  const { balances, tokenType, switchPaymentMethod } = useWallet();
  const { tokenToUSD } = useTokenPrice(tokenType);

  const [open, setOpen] = useState(false);
  const [showPackModal, setShowPackModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showMemoryViewer, setShowMemoryViewer] = useState(false);
  const { memories, deleteMemory, upsertByKey } = useMemories();
  const [showPersonalityPanel, setShowPersonalityPanel] = useState(false);
  const { personality, savePersonality, clearPersonality } = usePersonality();
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

  // Open memory viewer when a memory chip is clicked in chat
  useEffect(() => {
    const handler = () => setShowMemoryViewer(true);
    window.addEventListener('sogni-open-memory-viewer', handler);
    return () => window.removeEventListener('sogni-open-memory-viewer', handler);
  }, []);

  const currentBalance = balances?.[tokenType]?.net ?? '0';
  const tokenLabel = getTokenLabel(tokenType);
  const balanceNum = parseFloat(currentBalance);
  const balanceUSD = !isNaN(balanceNum) && balanceNum > 0 ? tokenToUSD(balanceNum) : null;

  const getMethodChipStyle = (method: TokenType): CSSProperties => {
    const isActive = tokenType === method;
    return {
      padding: '5px 12px',
      borderRadius: '100px',
      fontSize: '0.6875rem',
      fontWeight: 600,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      transition: 'all 0.2s ease',
      cursor: 'pointer',
      border: 'none',
      background: isActive ? '#ffffff' : 'transparent',
      color: isActive ? '#0a0a0a' : '#666',
    };
  };

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => showSignupModal('login')}
        disabled={isLoading}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: '#ffffff',
          color: '#0a0a0a',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.5 : 1,
        }}
      >
        {isLoading ? 'Loading...' : 'Sign In'}
      </button>
    );
  }

  return (
    <>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="true"
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          <span className="text-sm" style={{ color: '#b4b4b4' }}>
            {user?.username}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}>
            <path d="M2 4L5 7L8 4" stroke="#8e8e8e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: '240px',
            background: 'var(--color-bg-elevated)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 100,
            animation: 'dropdownFadeIn 0.15s ease',
            overflow: 'hidden',
          }}>
            {/* Wallet section — hidden in demo mode */}
            {authMode !== 'demo' && balances && (
              <>
                <div style={{
                  padding: '14px 14px 12px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    marginBottom: '6px',
                  }}>
                    <span style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: '#8e8e8e',
                    }}>
                      Balance
                    </span>
                    <a
                      href="https://www.sogni.ai/assets"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Learn about Sogni tokens & Spark"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '13px',
                        height: '13px',
                        borderRadius: '50%',
                        border: '1px solid #555',
                        fontSize: '8px',
                        lineHeight: 1,
                        color: '#8e8e8e',
                        textDecoration: 'none',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#d4d4d4';
                        e.currentTarget.style.borderColor = '#d4d4d4';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#8e8e8e';
                        e.currentTarget.style.borderColor = '#555';
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      ?
                    </a>
                  </div>
                  <div style={{
                    fontSize: '1.375rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    color: '#ececec',
                    letterSpacing: '-0.02em',
                    lineHeight: 1.2,
                  }}>
                    {formatTokenAmount(currentBalance, 2)}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#8e8e8e',
                    fontWeight: 500,
                    marginTop: '2px',
                  }}>
                    {tokenLabel}
                    {balanceUSD !== null && (
                      <span style={{ marginLeft: '4px' }}>
                        ~${balanceUSD.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Payment method toggle */}
                <div style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span style={{
                    fontSize: '0.75rem',
                    color: '#8e8e8e',
                    fontWeight: 500,
                  }}>
                    Pay with
                  </span>
                  <div style={{
                    display: 'flex',
                    gap: '2px',
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: '100px',
                    padding: '2px',
                  }}>
                    <button
                      onClick={() => switchPaymentMethod('sogni')}
                      style={getMethodChipStyle('sogni')}
                    >
                      Sogni
                    </button>
                    <button
                      onClick={() => switchPaymentMethod('spark')}
                      style={getMethodChipStyle('spark')}
                    >
                      Spark
                    </button>
                  </div>
                </div>

                {/* Buy Credits */}
                <button
                  onClick={() => { setShowPackModal(true); setOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    color: '#d4d4d4',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <span>Buy Credits</span>
                </button>

                {/* Billing History */}
                <button
                  onClick={() => { setShowBillingModal(true); setOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    color: '#d4d4d4',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b4b4b4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                    <line x1="9" y1="12" x2="15" y2="12" />
                    <line x1="9" y1="16" x2="13" y2="16" />
                  </svg>
                  <span>Billing History</span>
                </button>
              </>
            )}

            {/* Memories */}
            <button
              onClick={() => { setShowMemoryViewer(true); setOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#d4d4d4',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b4b4b4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
                <line x1="9" y1="21" x2="15" y2="21" />
              </svg>
              <span>Memories</span>
              {memories.length > 0 && (
                <span style={{
                  fontSize: '0.625rem', fontWeight: 600, background: 'rgba(255,255,255,0.08)',
                  color: '#8e8e8e', borderRadius: '100px', padding: '1px 6px', marginLeft: 'auto',
                }}>
                  {memories.length}
                </span>
              )}
            </button>

            {/* Personality */}
            <button
              onClick={() => { setShowPersonalityPanel(true); setOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#d4d4d4',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b4b4b4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Personality</span>
              {personality && (
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#22C55E',
                  marginLeft: 'auto',
                  flexShrink: 0,
                }} />
              )}
            </button>

            {/* Safe Content Filter toggle */}
            <button
              onClick={() => {
                if (safeContentFilter) {
                  // Disabling — show confirmation popup
                  requestDisableContentFilter();
                } else {
                  // Re-enabling — no popup needed
                  setSafeContentFilter(true);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <span style={{ fontSize: '0.8125rem', color: '#d4d4d4' }}>
                Safe Content Filter
              </span>
              <div style={{
                width: '36px',
                height: '20px',
                borderRadius: '10px',
                background: safeContentFilter ? '#4f8f4f' : '#555',
                position: 'relative',
                transition: 'background 0.2s ease',
                flexShrink: 0,
                marginLeft: '12px',
              }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '2px',
                  left: safeContentFilter ? '18px' : '2px',
                  transition: 'left 0.2s ease',
                }} />
              </div>
            </button>

            {/* Community section */}
            <div style={{
              padding: '10px 14px 4px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: '#8e8e8e',
              }}>
                Community
              </span>
            </div>
            <a
              href="https://x.com/Sogni_Protocol"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#d4d4d4',
                textAlign: 'left',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#b4b4b4">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>Follow on X</span>
            </a>
            <a
              href="https://discord.gg/2JjzA2zrrc"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#d4d4d4',
                textAlign: 'left',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#b4b4b4">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
              <span>Join Discord</span>
            </a>

            {/* Resources section */}
            <div style={{
              padding: '10px 14px 4px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: '#8e8e8e',
              }}>
                Resources
              </span>
            </div>
            <a
              href="https://www.sogni.ai/super-apps"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#d4d4d4',
                textAlign: 'left',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b4b4b4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              <span>Sogni Apps</span>
            </a>
            <a
              href="https://docs.sogni.ai/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#d4d4d4',
                textAlign: 'left',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b4b4b4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span>Help & Docs</span>
            </a>

            {/* Sign Out */}
            <button
              onClick={() => { setOpen(false); logout(); }}
              disabled={isLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                fontSize: '0.8125rem',
                color: '#8e8e8e',
                opacity: isLoading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#d4d4d4'; } }}
              onMouseLeave={(e) => { if (!isLoading) { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#8e8e8e'; } }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>{isLoading ? 'Signing out...' : 'Sign Out'}</span>
            </button>
          </div>
        )}
      </div>

      <PackPurchaseModal
        isOpen={showPackModal}
        onClose={() => setShowPackModal(false)}
      />

      <BillingHistoryModal
        isOpen={showBillingModal}
        onClose={() => setShowBillingModal(false)}
      />

      {showMemoryViewer && (
        <MemoryViewer
          memories={memories}
          onDelete={deleteMemory}
          onAdd={(key, value) => upsertByKey(key, value, 'preference', 'user')}
          onClose={() => setShowMemoryViewer(false)}
        />
      )}

      {showPersonalityPanel && (
        <PersonalityPanel
          personality={personality}
          onSave={savePersonality}
          onClear={clearPersonality}
          onClose={() => setShowPersonalityPanel(false)}
        />
      )}
    </>
  );
}
