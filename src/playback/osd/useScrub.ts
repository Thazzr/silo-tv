import { useCallback, useEffect, useRef, useState } from 'react';
import { clampTime, SCRUB_TICK_MS, stepRate } from './timing';

export interface ScrubState {
  /** Signed multiple of real time: 2, 4, 8 or 16, negative when going back. */
  rate: number;
  /** Where the playhead would land; on the source's timeline, in seconds. */
  target: number;
}

export interface Scrub {
  state: ScrubState | null;
  /** True from the call that entered scrub mode on, before the next render has seen it. */
  active(): boolean;
  /** Enters scrub mode from `from` (a first press) or steps the rate (every press after it). */
  press(direction: 1 | -1, from: number): void;
  /** Leaves scrub mode and returns the target, or null when not scrubbing. */
  commit(): number | null;
  /** Leaves scrub mode without moving the playhead. */
  cancel(): void;
}

/**
 * Scrub mode: the target runs ahead of (or behind) the real position at the current rate; the
 * playhead moves only when the viewer commits it.
 */
export function useScrub(duration: number): Scrub {
  const [state, setState] = useState<ScrubState | null>(null);
  const ref = useRef<ScrubState | null>(null);
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  });

  const set = useCallback((next: ScrubState | null) => {
    ref.current = next;
    setState(next);
  }, []);

  const press = useCallback(
    (direction: 1 | -1, from: number) => {
      const current = ref.current;
      set({
        rate: stepRate(current?.rate ?? 0, direction),
        target: current?.target ?? from,
      });
    },
    [set],
  );

  const commit = useCallback(() => {
    const target = ref.current?.target ?? null;
    set(null);
    return target;
  }, [set]);
  const cancel = useCallback(() => set(null), [set]);

  const isActive = useCallback(() => ref.current !== null, []);
  const active = state !== null;
  useEffect(() => {
    if (!active) return;
    let before = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const current = ref.current;
      if (current) {
        const target = clampTime(
          current.target + (current.rate * (now - before)) / 1000,
          durationRef.current,
        );
        set({ rate: current.rate, target });
      }
      before = now;
    }, SCRUB_TICK_MS);
    return () => clearInterval(timer);
  }, [active, set]);

  return { state, active: isActive, press, commit, cancel };
}
