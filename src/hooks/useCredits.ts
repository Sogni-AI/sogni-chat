/**
 * useCredits Hook
 * Tracks credit usage for the current session (localStorage-based).
 * All cost values come from API estimates passed in by callers — no hardcoded values.
 */

import { useState, useCallback } from 'react';

interface CreditUsage {
  restoration: number;
  video: number;
  total: number;
}

interface UseCreditsReturn {
  /** Usage history for this session */
  sessionUsage: CreditUsage;
  /** Track a restoration operation with its actual API-estimated cost */
  trackRestoration: (cost: number) => void;
  /** Track a video generation with its actual API-estimated cost */
  trackVideo: (cost: number) => void;
  /** Reset session usage */
  resetSession: () => void;
}

const STORAGE_KEY = 'sogni_restoration_credits_usage';

/**
 * Load usage history from localStorage
 */
function loadUsageHistory(): CreditUsage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('[useCredits] Failed to load usage history:', error);
  }
  return { restoration: 0, video: 0, total: 0 };
}

/**
 * Save usage history to localStorage
 */
function saveUsageHistory(usage: CreditUsage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch (error) {
    console.warn('[useCredits] Failed to save usage history:', error);
  }
}

export function useCredits(): UseCreditsReturn {
  const [sessionUsage, setSessionUsage] = useState<CreditUsage>(loadUsageHistory);

  // Track restoration usage with actual cost from API estimate
  const trackRestoration = useCallback((cost: number) => {
    setSessionUsage(prev => {
      const updated = {
        restoration: prev.restoration + cost,
        video: prev.video,
        total: prev.total + cost
      };
      saveUsageHistory(updated);
      return updated;
    });
  }, []);

  // Track video usage with actual cost from API estimate
  const trackVideo = useCallback((cost: number) => {
    setSessionUsage(prev => {
      const updated = {
        restoration: prev.restoration,
        video: prev.video + cost,
        total: prev.total + cost
      };
      saveUsageHistory(updated);
      return updated;
    });
  }, []);

  // Reset session usage
  const resetSession = useCallback(() => {
    const reset = { restoration: 0, video: 0, total: 0 };
    setSessionUsage(reset);
    saveUsageHistory(reset);
  }, []);

  return {
    sessionUsage,
    trackRestoration,
    trackVideo,
    resetSession
  };
}

export default useCredits;
