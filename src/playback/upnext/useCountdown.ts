import { useEffect, useRef, useState } from 'react';

/**
 * A countdown in whole seconds that runs while `active` and starts over with `total` each time it
 * becomes active. Reaching 0 calls `onDone` once per run. It keeps running while the focus moves:
 * only `active` stops it.
 */
export function useCountdown(active: boolean, total: number, onDone: () => void): number {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const [seconds, setSeconds] = useState(total);
  // A run starts with its whole count (derived while rendering, so its first frame shows it).
  const [wasActive, setWasActive] = useState(false);
  if (active !== wasActive) {
    setWasActive(active);
    setSeconds(total);
  }

  const counting = active && seconds > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => setSeconds((left) => left - 1), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  const fired = useRef(false);
  useEffect(() => {
    if (!active) fired.current = false;
    else if (seconds <= 0 && !fired.current) {
      fired.current = true;
      done.current();
    }
  }, [active, seconds]);

  return seconds;
}
