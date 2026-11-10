import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * The menu buttons of the overlay. `info` opens a column on the left; the others open a popover
 * above their button.
 */
export type OsdMenu = 'audio' | 'chapters' | 'subtitles' | 'settings' | 'info';
/** The menus that are a popover above their button (every one but Info). */
export type PopoverMenu = Exclude<OsdMenu, 'info'>;

/** The menu buttons in the order of the row; a menu the playing file has nothing for is left out. */
export const MENU_ORDER: readonly OsdMenu[] = [
  'audio',
  'chapters',
  'subtitles',
  'settings',
  'info',
];

export const isPopover = (menu: OsdMenu | null): menu is PopoverMenu =>
  menu !== null && menu !== 'info';

export interface PanelState {
  /** The menu that is open, or null. */
  open: OsdMenu | null;
  /** Notes the focused row, to take the focus back after the stream reloads. */
  remember(key: string): void;
  /** The remembered focus key; null (a fresh opening) means the menu's own first choice. */
  recall(): string | null;
  show(menu: OsdMenu): void;
  hide(): void;
  /**
   * Closes the menu after a pick that loads a new stream. The view that mounts for that stream
   * starts with the overlay up and the focus on `menu`'s button, as after any close.
   */
  finish(menu: OsdMenu): void;
  /** The button a `finish` left the next view to land on; null when there is none. */
  arrival(): OsdMenu | null;
  /** The views have taken the arrival; a later view starts as a fresh one. */
  settle(): void;
}

/**
 * The open menu's state. It lives in the screen, above the playing view: a quality change reloads
 * the stream and the view with it, and the menu must still be open with the focus where it was.
 */
export function usePanelState(): PanelState {
  const [open, setOpen] = useState<OsdMenu | null>(null);
  const focusKey = useRef<string | null>(null);
  const landing = useRef<OsdMenu | null>(null);

  const remember = useCallback((key: string) => void (focusKey.current = key), []);
  const recall = useCallback(() => focusKey.current, []);
  const show = useCallback((menu: OsdMenu) => {
    focusKey.current = null;
    setOpen(menu);
  }, []);
  const hide = useCallback(() => {
    focusKey.current = null;
    landing.current = null;
    setOpen(null);
  }, []);
  const finish = useCallback((menu: OsdMenu) => {
    focusKey.current = null;
    landing.current = menu;
    setOpen(null);
  }, []);
  const arrival = useCallback(() => landing.current, []);
  const settle = useCallback(() => void (landing.current = null), []);

  return useMemo(
    () => ({ open, remember, recall, show, hide, finish, arrival, settle }),
    [open, remember, recall, show, hide, finish, arrival, settle],
  );
}
