// Where the latest focus change came from. The Magic Remote pointer moves the focus by hovering
// (every object needs a selection effect), but it must never scroll anything: a half-visible card
// at the edge of the screen would be hovered, scroll into view, and slide the next card under the
// cursor, which then scrolls again. Only the arrow keys (and the wheel, which presses them) scroll
// (user decision 2026-11-09).
//
// The pointer remembers the element it focused. The focus counts as the pointer's for exactly as
// long as that element is the focused one: any other focus change (programmatic, a restore after
// an unmount) moves the current key away, and a key press forgets the element at once.
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';

let pointerKey: string | null = null;

/** The pointer is about to focus `focusKey`; call right before the focus is set. */
export function markPointerFocus(focusKey: string): void {
  pointerKey = focusKey;
}

/** Forgets the pointer's element (any key press, any programmatic focus). */
export function clearPointerFocus(): void {
  pointerKey = null;
}

/**
 * True while the focused element is the one the pointer put the focus on. Everything that scrolls
 * to the focused element (page transforms, row strips, grids, native scrolling) skips it then.
 */
export function focusFromPointer(): boolean {
  return pointerKey !== null && pointerKey === getCurrentFocusKey();
}

/** Starts forgetting the pointer's element on every key press; returns the function that stops it. */
export function startOriginTracking(): () => void {
  // Capture phase and first in line: the key press that moves the focus must already see "keys".
  window.addEventListener('keydown', clearPointerFocus, true);
  return () => {
    window.removeEventListener('keydown', clearPointerFocus, true);
    clearPointerFocus();
  };
}
