// Sizes of the box set page (docs/design.md); CSS pixels on the 1920x1080 layout, matching
// src/styles/boxset.css. The page scrolls once: from the hero to the block of films.
import { SAFE_TOP } from '../detail/layout';

/** The least height of the hero (no logo, so lower than a detail page's). */
export const BOXSET_HERO_HEIGHT = 690;
/** The "Movies" heading of the films block and the space below it. */
export const FILMS_HEAD_HEIGHT = 48;
export const FILMS_HEAD_GAP = 16;
/** The grid viewport starts below the heading when the page is scrolled to the films. */
export const BOXSET_GRID_TOP = SAFE_TOP + FILMS_HEAD_HEIGHT + FILMS_HEAD_GAP;

/** Where the focus is: the hero (title, Play), or the grid of films. */
export type BoxSetZone = 'top' | 'films';

/**
 * How far the page is scrolled: nothing while the focus is in the hero, and with the focus in the
 * grid the films block (its heading) sits on the top safe-area line. The block's top is measured,
 * because the hero grows with a long title or overview; unknown (not measured yet) leaves the page
 * where it is.
 */
export function boxSetScrollOffset(zone: BoxSetZone, filmsTop: number | undefined): number {
  if (zone === 'top' || filmsTop === undefined) return 0;
  return Math.max(0, filmsTop - SAFE_TOP);
}
