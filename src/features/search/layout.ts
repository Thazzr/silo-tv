// Sizes of the Search tab (docs/design.md), in CSS pixels on the 1920x1080 layout. They must match
// src/styles/search.css. The keyboard sits left, the results in a column from x 736 (the cards
// start 24 px further in, at x 760, so a focused card's scale is not clipped).
import { gridMetrics, rowHeight } from '../../ui/media';

/** Four posters across the results column: 4 x 236 and three gaps of 40 fill its 1064 px. */
export const SEARCH_GRID = gridMetrics(4, { width: 236, height: 354 }, 40, 24);
/** The rows of box sets and people: posters of the row size, five across in the column. */
export const SEARCH_ROW_INSET = 24;
export const SEARCH_ROW_VISIBLE = 5;
/** The compact people row: 150 px columns, five across. */
export const SEARCH_PEOPLE_VISIBLE = 5;

/**
 * How far the text of the query field is shifted left so that its end (and the caret) stay in
 * view: nothing while it fits.
 */
export function fieldShift(contentWidth: number, boxWidth: number): number {
  return Math.max(0, Math.ceil(contentWidth - boxWidth));
}

/** Which part of the results the page is scrolled to. */
export type SearchZone = 'top' | 'grid';

/**
 * How far the results page is moved up. With the focus in the titles the rows of box sets and
 * people above them make way, so the count and the grid take the whole column; otherwise the page
 * rests at the top.
 */
export function searchScrollOffset(zone: SearchZone, boxSets: boolean, people: boolean): number {
  if (zone !== 'grid') return 0;
  return (boxSets ? rowHeight('poster') : 0) + (people ? rowHeight('person') : 0);
}
