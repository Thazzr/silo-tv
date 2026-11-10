import { useCallback, useEffect, useRef, useState } from 'react';
import { OSD_HIDE_MS } from './timing';

export interface OsdVisibility {
  visible: boolean;
  /** Opens the overlay and restarts the idle countdown. */
  show(): void;
  hide(): void;
  /** Activity while the overlay is open: restarts the idle countdown. */
  poke(): void;
}

/**
 * The overlay's visibility: it hides `OSD_HIDE_MS` after the last activity, but never while
 * `holdOpen` is true (paused, buffering, seeking, a menu open). When the hold ends the countdown
 * starts anew. `initiallyVisible` is for a player that reloads its stream while a menu is open.
 */
export function useOsdVisibility(holdOpen: boolean, initiallyVisible = false): OsdVisibility {
  const [visible, setVisible] = useState(initiallyVisible);
  const [activity, setActivity] = useState(0);
  const visibleRef = useRef(initiallyVisible);

  const hide = useCallback(() => {
    visibleRef.current = false;
    setVisible(false);
  }, []);
  const show = useCallback(() => {
    visibleRef.current = true;
    setVisible(true);
    setActivity((n) => n + 1);
  }, []);
  const poke = useCallback(() => {
    if (visibleRef.current) setActivity((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!visible || holdOpen) return;
    const timer = setTimeout(hide, OSD_HIDE_MS);
    return () => clearTimeout(timer);
  }, [visible, holdOpen, activity, hide]);

  return { visible, show, hide, poke };
}
