import { useCallback, useEffect, useRef, useState } from 'react';
import { clampTime, COMMIT_MEMORY_MS, SKIP_COMMIT_MS } from './timing';

export interface SkipAccumulator {
  /** The target the pending presses add up to; null when nothing is pending. */
  pending: number | null;
  /** Adds a skip to the pending target and (re)starts the commit countdown. */
  add(delta: number): void;
  /** Drops the pending target without seeking. */
  cancel(): void;
  /** Seeks to `target` at once, replacing any pending skip (a click on the scrubber, a scrub). */
  commitNow(target: number): void;
  /** Where the viewer last pointed the playhead: the pending target or a seek still in flight. */
  peek(): number | null;
}

interface Options {
  /** The current position on the source's timeline. */
  read(): number | null;
  duration: number;
  commit(target: number): void;
}

/**
 * Rapid skip presses accumulate into one target and become ONE seek `SKIP_COMMIT_MS` after the
 * last press, so a burst of presses does not start a burst of seeks (each one may be a replan).
 */
export function useSkipAccumulator(options: Options): SkipAccumulator {
  const [pending, setPending] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef<{ target: number; at: number } | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pendingRef.current = null;
    setPending(null);
  }, []);

  const commitNow = useCallback(
    (target: number) => {
      clear();
      last.current = { target, at: Date.now() };
      latest.current.commit(target);
    },
    [clear],
  );

  const peek = useCallback(() => {
    if (pendingRef.current !== null) return pendingRef.current;
    const recent = last.current;
    return recent && Date.now() - recent.at < COMMIT_MEMORY_MS ? recent.target : null;
  }, []);

  const add = useCallback(
    (delta: number) => {
      const base = peek() ?? latest.current.read();
      if (base === null) return;
      const target = clampTime(base + delta, latest.current.duration);
      pendingRef.current = target;
      setPending(target);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commitNow(target), SKIP_COMMIT_MS);
    },
    [peek, commitNow],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return { pending, add, cancel: clear, commitNow, peek };
}
