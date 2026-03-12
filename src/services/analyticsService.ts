/**
 * Frontend Analytics Service
 * Tracks restoration, download, share, and video generation events via Google Analytics (GA4)
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

/**
 * Send an event to Google Analytics
 */
function sendGA4Event(eventName: string, params: Record<string, any> = {}) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, params);
  }
}

/**
 * Track a SPA page view (call on route changes since auto page_view is disabled)
 */
export function trackPageView(path: string, title: string) {
  sendGA4Event('page_view', { page_path: path, page_title: title });
}

/**
 * Analytics event types
 */
export type AnalyticsEventType =
  | 'restoration_started'
  | 'restoration_completed'
  | 'restoration_failed'
  | 'file_download'
  | 'share'
  | 'video_generation_started'
  | 'video_generation_completed'
  | 'video_generation_failed';

/**
 * Analytics event interface
 */
export interface AnalyticsEvent {
  type: AnalyticsEventType;
  timestamp: number;
  metadata?: Record<string, any>;
}

const MAX_LOCAL_EVENTS = 1000;
const STORAGE_KEY = 'sogni_restoration_analytics_events';

function getStoredEvents(): AnalyticsEvent[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('[Analytics] Failed to read stored events:', error);
  }
  return [];
}

function storeEvent(event: AnalyticsEvent): void {
  try {
    const events = getStoredEvents();
    events.push(event);

    if (events.length > MAX_LOCAL_EVENTS) {
      events.splice(0, events.length - MAX_LOCAL_EVENTS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (error) {
    console.warn('[Analytics] Failed to store event:', error);
  }
}

export const trackRestorationStarted = async (metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'restoration_started', timestamp: Date.now(), metadata };
  storeEvent(event);
  sendGA4Event('restoration_started', metadata);
  if (import.meta.env.DEV) console.log('[Analytics] Restoration started:', metadata);
};

export const trackRestorationCompleted = async (metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'restoration_completed', timestamp: Date.now(), metadata };
  storeEvent(event);
  sendGA4Event('restoration_completed', metadata);
  if (import.meta.env.DEV) console.log('[Analytics] Restoration completed:', metadata);
};

export const trackRestorationFailed = async (error: string, metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'restoration_failed', timestamp: Date.now(), metadata: { error, ...metadata } };
  storeEvent(event);
  sendGA4Event('restoration_failed', { error, ...metadata });
  if (import.meta.env.DEV) console.log('[Analytics] Restoration failed:', error, metadata);
};

export const trackDownload = async (metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'file_download', timestamp: Date.now(), metadata };
  storeEvent(event);
  sendGA4Event('file_download', metadata);
  if (import.meta.env.DEV) console.log('[Analytics] Download tracked:', metadata);
};

export const trackShare = async (shareType: string = 'unknown', metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'share', timestamp: Date.now(), metadata: { shareType, ...metadata } };
  storeEvent(event);
  sendGA4Event('share', { method: shareType, ...metadata });
  if (import.meta.env.DEV) console.log('[Analytics] Share tracked:', shareType, metadata);
};

export const trackVideoGenerationStarted = async (metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'video_generation_started', timestamp: Date.now(), metadata };
  storeEvent(event);
  sendGA4Event('video_generation_started', metadata);
  if (import.meta.env.DEV) console.log('[Analytics] Video generation started:', metadata);
};

export const trackVideoGenerationCompleted = async (metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'video_generation_completed', timestamp: Date.now(), metadata };
  storeEvent(event);
  sendGA4Event('video_generation_completed', metadata);
  if (import.meta.env.DEV) console.log('[Analytics] Video generation completed:', metadata);
};

export const trackVideoGenerationFailed = async (error: string, metadata: Record<string, any> = {}) => {
  const event: AnalyticsEvent = { type: 'video_generation_failed', timestamp: Date.now(), metadata: { error, ...metadata } };
  storeEvent(event);
  sendGA4Event('video_generation_failed', { error, ...metadata });
  if (import.meta.env.DEV) console.log('[Analytics] Video generation failed:', error, metadata);
};

export const getStoredAnalyticsEvents = (): AnalyticsEvent[] => {
  return getStoredEvents();
};

export const clearStoredAnalyticsEvents = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (import.meta.env.DEV) console.log('[Analytics] Cleared stored events');
  } catch (error) {
    console.warn('[Analytics] Failed to clear stored events:', error);
  }
};

// Export for debugging in browser console
if (typeof window !== 'undefined') {
  (window as any).analyticsService = {
    trackRestorationStarted,
    trackRestorationCompleted,
    trackRestorationFailed,
    trackDownload,
    trackShare,
    trackVideoGenerationStarted,
    trackVideoGenerationCompleted,
    trackVideoGenerationFailed,
    getStoredAnalyticsEvents,
    clearStoredAnalyticsEvents
  };
}
