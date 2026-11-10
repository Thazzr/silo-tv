import { useCallback, useMemo, useRef, useState } from 'react';

export type PanelTab = 'info' | 'video' | 'chapters';
/** Where the panel was opened from: the Options button (the overlay was open) or with it hidden. */
export type PanelOrigin = 'button' | 'hidden';

export interface PanelState {
  open: boolean;
  /** The tab shown; it is also the one the panel opens on next time. */
  tab: PanelTab;
  origin: PanelOrigin;
  /** Notes the focused element, to take the focus back after the stream reloads. */
  remember(key: string): void;
  /** The remembered focus key; null (a fresh opening) means the tab strip. */
  recall(): string | null;
  show(origin: PanelOrigin): void;
  hide(): void;
  setTab(tab: PanelTab): void;
}

/**
 * The options panel's state. It lives in the screen, above the playing view: a quality change
 * reloads the stream and the view with it, and the panel must still be open on the same tab with
 * the focus where it was.
 */
export function usePanelState(): PanelState {
  const [state, setState] = useState<{ open: boolean; tab: PanelTab; origin: PanelOrigin }>({
    open: false,
    tab: 'info',
    origin: 'button',
  });
  const focusKey = useRef<string | null>(null);

  const remember = useCallback((key: string) => void (focusKey.current = key), []);
  const recall = useCallback(() => focusKey.current, []);
  const show = useCallback((origin: PanelOrigin) => {
    focusKey.current = null;
    setState((old) => ({ ...old, open: true, origin }));
  }, []);
  const hide = useCallback(() => {
    focusKey.current = null;
    setState((old) => ({ ...old, open: false }));
  }, []);
  const setTab = useCallback(
    (tab: PanelTab) => setState((old) => (old.tab === tab ? old : { ...old, tab })),
    [],
  );

  return useMemo(
    () => ({ ...state, remember, recall, show, hide, setTab }),
    [state, remember, recall, show, hide, setTab],
  );
}
