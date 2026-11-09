// Sizes of the person page (docs/design.md); CSS pixels on the 1920x1080 layout, matching
// src/styles/person.css. The page scrolls once: from the header to the filmography.
import { SAFE_TOP } from '../detail/layout';

export const PERSON_INSET = 80;
export const PORTRAIT = { width: 300, height: 450 } as const;
/** The filter pills (75 px, like every target) and the space below them. */
export const PILLS_HEIGHT = 75;
export const PILLS_GAP = 12;
/** The grid viewport starts below the pills when the page is scrolled to them. */
export const GRID_TOP = SAFE_TOP + PILLS_HEIGHT + PILLS_GAP;

/** Where the focus is: the header and the pills, or the filmography grid. */
export type PersonZone = 'top' | 'grid';

/**
 * How far the page is scrolled: nothing while the focus is at the top, and with the focus in the
 * grid the pills row sits on the top safe-area line. The pills' top is measured, because the header
 * grows with the biography; unknown (not measured yet) leaves the page where it is.
 */
export function personScrollOffset(zone: PersonZone, pillsTop: number | undefined): number {
  if (zone === 'top' || pillsTop === undefined) return 0;
  return Math.max(0, pillsTop - SAFE_TOP);
}
