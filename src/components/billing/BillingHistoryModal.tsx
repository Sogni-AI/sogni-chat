/**
 * Billing History Modal
 *
 * Shows a local tally of SOGNI/Spark spent and a chronological
 * list of charges aggregated into logical line items.
 */

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBillingHistory } from '../../hooks/useBillingHistory';
import type { BillingLineItem, BillingJobType } from '../../types/billing';
import '../../styles/components/BillingHistory.css';

interface BillingHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Format a timestamp into a readable date/time string */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (isToday) return `Today ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ` ${time}`;
}

/** Get the primary label for a line item */
function getLineLabel(item: BillingLineItem): string {
  const count = item.itemCount;
  switch (item.type) {
    case 'restoration':
      return `${count} Image${count !== 1 ? 's' : ''}`;
    case 'video':
      return `${count} Video${count !== 1 ? 's' : ''}`;
    case 'style':
      return `${count} Style Transfer${count !== 1 ? 's' : ''}`;
    case 'angle':
      return `${count} Angle${count !== 1 ? 's' : ''}`;
  }
}

/** Get the detail line for a line item */
function getLineDetail(item: BillingLineItem): string {
  return item.quality ?? '';
}

/** Icon component for line item type */
function LineIcon({ type }: { type: BillingJobType }) {
  switch (type) {
    case 'restoration':
      return (
        <div className={`billing-line-icon ${type}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <circle cx="12" cy="13" r="3" strokeWidth={2} />
          </svg>
        </div>
      );
    case 'video':
      return (
        <div className={`billing-line-icon ${type}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
      );
    case 'style':
      return (
        <div className={`billing-line-icon ${type}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        </div>
      );
    case 'angle':
      return (
        <div className={`billing-line-icon ${type}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      );
  }
}

const BillingHistoryModal = ({ isOpen, onClose }: BillingHistoryModalProps) => {
  const { lineItems, summary, loading, clearHistory } = useBillingHistory();
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset confirmation state when modal closes
  useEffect(() => {
    if (!isOpen) setConfirmClear(false);
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleClear = useCallback(async () => {
    await clearHistory();
    setConfirmClear(false);
  }, [clearHistory]);

  if (!isOpen) return null;

  return createPortal(
    <div className="billing-history-overlay" onClick={onClose}>
      <div className="billing-history-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="billing-history-header">
          <h2>Billing History</h2>
          <button className="billing-history-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary Bar */}
        {summary.recordCount > 0 && (
          <div className="billing-summary-bar">
            {summary.totalSpark > 0 && (
              <div className="billing-summary-item">
                <span className="billing-summary-label">Spark</span>
                <span className="billing-summary-value spark">{summary.totalSpark.toFixed(2)}</span>
              </div>
            )}
            {summary.totalSogni > 0 && (
              <div className="billing-summary-item">
                <span className="billing-summary-label">SOGNI</span>
                <span className="billing-summary-value sogni">{summary.totalSogni.toFixed(2)}</span>
              </div>
            )}
            <div className="billing-summary-item">
              <span className="billing-summary-label">Total USD</span>
              <span className="billing-summary-value usd">${summary.totalUSD.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* List */}
        <div className="billing-list">
          {loading ? (
            <div className="billing-empty">
              <span className="billing-empty-text">Loading...</span>
            </div>
          ) : lineItems.length === 0 ? (
            <div className="billing-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="40" height="40">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="billing-empty-text">No billing history yet</span>
            </div>
          ) : (
            lineItems.map((item) => (
              <div key={item.id} className="billing-line-item">
                <LineIcon type={item.type} />
                <div className="billing-line-details">
                  <div className="billing-line-primary">{getLineLabel(item)}</div>
                  <div className="billing-line-secondary">
                    {[formatTimestamp(item.timestamp), getLineDetail(item)]
                      .filter(Boolean)
                      .join(' \u00b7 ')}
                  </div>
                </div>
                <div className="billing-line-cost">
                  <div className="billing-line-cost-token">
                    {item.totalCostToken.toFixed(2)} {item.tokenType === 'spark' ? 'Spark' : 'SOGNI'}
                  </div>
                  <div className="billing-line-cost-usd">
                    ${item.totalCostUSD.toFixed(2)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {lineItems.length > 0 && (
          <div className="billing-footer">
            {confirmClear ? (
              <div className="billing-confirm-clear">
                <span className="billing-confirm-text">Clear all history?</span>
                <button className="billing-confirm-yes" onClick={() => void handleClear()}>
                  Clear
                </button>
                <button className="billing-confirm-no" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="billing-clear-btn" onClick={() => setConfirmClear(true)}>
                Clear History
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default BillingHistoryModal;
