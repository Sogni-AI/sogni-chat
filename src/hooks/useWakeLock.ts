import { useEffect, useRef } from 'react';

/**
 * Prevents the screen from sleeping while `active` is true.
 * Uses the Screen Wake Lock API — no-ops on unsupported browsers.
 * Automatically re-acquires the lock when the page regains visibility
 * (iOS releases wake locks when the tab is backgrounded).
 */
export function useWakeLock(active: boolean): void {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let released = false;

    async function acquire() {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[WAKE LOCK] Acquired');
        wakeLockRef.current.addEventListener('release', () => {
          console.log('[WAKE LOCK] Released');
          wakeLockRef.current = null;
        });
      } catch (err) {
        console.log('[WAKE LOCK] Failed to acquire:', err);
      }
    }

    function onVisibilityChange() {
      if (!released && document.visibilityState === 'visible') {
        acquire();
      }
    }

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [active]);
}
