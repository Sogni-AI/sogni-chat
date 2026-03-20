/**
 * Safe Content Filter preference.
 * When enabled (default), generated content passes through the NSFW safety filter.
 * Users can disable this globally via the account dropdown menu.
 *
 * Supports two storage tiers:
 * - localStorage (permanent): persists across browser sessions
 * - sessionStorage (session-only): cleared when the browser is fully closed
 */

const STORAGE_KEY = 'sogni:safeContentFilter';
const SESSION_STORAGE_KEY = 'sogni:safeContentFilter:session';

export function getSavedContentFilter(): boolean {
  const permanent = localStorage.getItem(STORAGE_KEY);
  if (permanent === 'false') return false;

  const session = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (session === 'false') return false;

  return true; // default: filter enabled
}

export function saveContentFilter(enabled: boolean, permanent?: boolean): void {
  if (enabled) {
    // Re-enabling: clear both storage keys, revert to default (enabled)
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } else if (permanent) {
    // Permanent disable: write to localStorage, clear sessionStorage
    localStorage.setItem(STORAGE_KEY, 'false');
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } else {
    // Session-only disable: write to sessionStorage, clear localStorage
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'false');
    localStorage.removeItem(STORAGE_KEY);
  }
}
