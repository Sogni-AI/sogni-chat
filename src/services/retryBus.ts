/**
 * Lightweight event bus for coordinating per-clip retries between
 * tool handlers (which stay alive waiting) and UI retry buttons.
 */

const listeners = new Map<string, () => void>();

export function onRetry(key: string): Promise<void> {
  return new Promise(resolve => {
    listeners.set(key, resolve);
  });
}

export function triggerRetry(key: string): void {
  const resolve = listeners.get(key);
  if (resolve) {
    listeners.delete(key);
    resolve();
  }
}

export function cancelRetry(key: string): void {
  listeners.delete(key);
}
