import { createContext } from 'react';
import { doesFocusableExist, isInside, setFocus } from './init';

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Decides an arrow press for the whole subtree of a FocusGroup: `fromKey` is the focused element.
 * True means "handled" (the handler moved the focus itself, or dropped the press) and the
 * library's spatial search does not run; false leaves the press to the next group up and, at the
 * top, to the library. Rows, grids and stacks of rows know where each element is, so they move
 * the focus by index; the library's search measures every sibling on every press.
 */
export type ArrowHandler = (direction: ArrowDirection, fromKey: string) => boolean;

/** The handler of the nearest FocusGroup that has one (its own and those of the groups above it). */
export const ArrowContext = createContext<ArrowHandler | null>(null);

/**
 * Moves the focus to `focusKey` when that element exists. An element that is not mounted yet (a
 * press that outran the render) drops the press instead of letting the focus point at nothing.
 */
export function moveFocusTo(focusKey: string): true {
  if (doesFocusableExist(focusKey)) void setFocus(focusKey);
  return true;
}

/**
 * Up and Down through a vertical stack of blocks (rows on Home and in a library's Recommended
 * view). `stops` holds the focus key of each block in order; the block's own saved child takes
 * the focus. At the first and last block the press is left to the library (hero, top bar).
 */
export function stackArrows(stops: readonly string[]): ArrowHandler {
  return (direction, fromKey) => {
    if (direction !== 'up' && direction !== 'down') return false;
    const at = stops.findIndex((stop) => fromKey === stop || isInside(fromKey, stop));
    const target = stops[at + (direction === 'down' ? 1 : -1)];
    return at < 0 || target === undefined ? false : moveFocusTo(target);
  };
}
