/**
 * Changelog version tracking — localStorage-backed.
 *
 * Tracks which version the user last viewed so the UI can
 * show a notification dot for unseen updates.
 */

const STORAGE_KEY = 'sogni:lastSeenVersion';

export function getLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function markVersionSeen(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    /* localStorage unavailable */
  }
}

export function hasUnseenUpdates(currentVersion: string): boolean {
  return getLastSeenVersion() !== currentVersion;
}
