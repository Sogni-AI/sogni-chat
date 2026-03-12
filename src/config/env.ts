/**
 * Centralized environment variable access with validation.
 * All env var reads should go through these functions.
 */

function getEnvVar(key: string, required = false): string {
  const value = import.meta.env[key] as string | undefined;
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || '';
}

export function getSogniAppId(): string {
  return getEnvVar('VITE_SOGNI_APP_ID') || 'sogni-chat';
}

export function getSogniEnv(): string {
  return getEnvVar('VITE_SOGNI_ENV') || 'production';
}

export function isProduction(): boolean {
  return import.meta.env.PROD;
}

export function isDevelopment(): boolean {
  return import.meta.env.DEV;
}

export function getAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
}
