import { useEffect, useRef, useState } from 'react';

/**
 * Follows `on` with a delay before it turns true and a minimum time it stays true, so a short
 * stall shows nothing and a shown spinner does not flicker away.
 */
export function useDelayedFlag(on: boolean, delayMs: number, minMs: number): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (on) {
      if (shown) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    if (!shown) return;
    const remaining = Math.max(0, minMs - (Date.now() - shownAt.current));
    const timer = setTimeout(() => setShown(false), remaining);
    return () => clearTimeout(timer);
  }, [on, shown, delayMs, minMs]);

  return shown;
}
