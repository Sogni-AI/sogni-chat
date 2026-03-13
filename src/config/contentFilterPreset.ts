/**
 * Safe Content Filter preference.
 * When enabled (default), generated content passes through the NSFW safety filter.
 * Users can disable this globally via the account dropdown menu.
 */

const STORAGE_KEY = 'sogni:safeContentFilter';

export function getSavedContentFilter(): boolean {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') return false;
  return true; // default: filter enabled
}

export function saveContentFilter(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}
