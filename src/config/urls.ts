/**
 * Centralized URL configuration.
 * Resolves API and app URLs based on the current environment.
 */

import { isProduction } from './env';

const PRODUCTION_APP_URL = 'https://chat.sogni.ai';
const PRODUCTION_API_URL = 'https://chat.sogni.ai/api';
const LOCAL_API_URL = '/api';

export function getApiBaseUrl(): string {
  // In development, use relative URL (proxied by Vite or nginx)
  if (!isProduction()) {
    return LOCAL_API_URL;
  }
  return PRODUCTION_API_URL;
}

export function getAppUrl(): string {
  if (!isProduction()) {
    return window.location.origin;
  }
  return PRODUCTION_APP_URL;
}

export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}
