/**
 * Changelog Modal — "What's New"
 *
 * Mirrors the BillingHistoryModal pattern: createPortal, dark card,
 * scrollable list of version entries with category badges.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ChangelogEntry } from '@/hooks/useChangelog';
import '@/styles/components/Changelog.css';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
}

function CategoryBadge({ type }: { type: string }) {
  const label = type || 'OTHER';
  const cls = label.toLowerCase();
  return <span className={`changelog-category ${cls}`}>{label}</span>;
}

const ChangelogModal = ({ isOpen, onClose, entries }: ChangelogModalProps) => {
  // Escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="changelog-overlay" onClick={onClose}>
      <div className="changelog-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="changelog-header">
          <h2>What's New</h2>
          <button className="changelog-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="changelog-list">
          {entries.length === 0 ? (
            <div className="changelog-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="40" height="40">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              <span className="changelog-empty-text">No updates yet</span>
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.version} className="changelog-entry">
                <div className="changelog-version-row">
                  <span className="changelog-version">v{entry.version}</span>
                  {entry.date && <span className="changelog-date">{entry.date}</span>}
                </div>
                {entry.changes.map((change, i) => (
                  <div key={i} className="changelog-item">
                    <CategoryBadge type={change.type} />
                    <span className="changelog-item-text">{change.text}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ChangelogModal;
