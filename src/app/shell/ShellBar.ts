import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Which parts of the active tab's content are away from their top. The floating top bar leaves
 * while any part is and comes back when all are at the top. It is a store of its own, not state of
 * the shell: a change must redraw the bar only, not the shell and the content under it.
 */
export class BarAwayStore {
  private readonly reporters = new Set<object>();
  private readonly listeners = new Set<() => void>();
  private away = false;

  /** A reporter says that its part is away (true) or back at the top (false). */
  report = (reporter: object, away: boolean): void => {
    if (away) this.reporters.add(reporter);
    else this.reporters.delete(reporter);
    const now = this.reporters.size > 0;
    if (now === this.away) return;
    this.away = now;
    this.listeners.forEach((listener) => listener());
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isAway = (): boolean => this.away;
}

/**
 * The shell's store. Outside the shell (a screen with no top bar) it is a store that no bar listens
 * to, so a grid or a page that reports is harmless there.
 */
export const ShellBarContext = createContext(new BarAwayStore());

/**
 * Tells the shell that the content has left its top: scrolled down, lifted by a transform, or
 * moved into a mode that covers the part under the top bar. A part that goes away (unmounts) is
 * back at the top by definition.
 */
export function useBarAway(away: boolean): void {
  const store = useContext(ShellBarContext);
  const reporter = useRef({});
  useEffect(() => {
    const id = reporter.current;
    store.report(id, away);
    return () => store.report(id, false);
  }, [store, away]);
}

/** Whether the content is away from its top, for the top bar. */
export function useContentAway(): boolean {
  const store = useContext(ShellBarContext);
  return useSyncExternalStore(store.subscribe, store.isAway);
}
