// Sizes of the detail page (docs/design.md). All values are CSS pixels on the 1920x1080 layout and
// must match src/styles/detail.css. The page scrolls in steps from one section to the next; the
// offsets come from the measured block tops, not from heights kept here.
import { CARD_GAP, SCREEN_WIDTH, STRIP_PADDING } from '../../ui/media';

/** Side inset of the detail pages. */
export const DETAIL_INSET = 100;
/** The least height of the hero; it grows with its text column (logo, synopsis, credits, actions). */
export const HERO_HEIGHT = 760;
/** The hero's text column (title, facts, synopsis, credits), from the inset to 1000 px. */
export const DETAIL_TEXT_WIDTH = 900;
/**
 * The least opacity of black over the backdrop under the text column; src/styles/detail.css draws
 * at least this (0.92 up to 1075 px). A white backdrop then shows as #141414 or darker.
 */
export const DETAIL_SHADE_MIN_ALPHA = 0.92;
/**
 * The darkening layer that fades in once the focus has left the hero; src/styles/detail.css draws
 * this alone, so with the shade under it the whole backdrop is at least this black: secondary text
 * keeps 4.5:1 over a white picture anywhere on screen.
 */
export const DETAIL_SCROLLED_DIM_ALPHA = 0.85;

/** The top of the safe area (5 % of 1080 px): scrolled-to blocks start on this line. */
export const SAFE_TOP = 54;

/** The blocks of the page the view snaps between, in page order. */
export type DetailZone = 'hero' | 'episodes' | 'cast' | 'boxSet' | 'similar';
/** The zones below the hero, which have a block of their own to scroll to. */
export type DetailBlockZone = Exclude<DetailZone, 'hero'>;
/** The measured top of each block below the hero inside the page (layout position, in px). */
export type DetailBlockTops = Partial<Record<DetailBlockZone, number>>;

/**
 * How far the page is scrolled while the focus is in `zone`: the hero stays at the origin, and any
 * other block is scrolled so its first line (the season pills, a row's title) sits on the top
 * safe-area line. The tops are measured from the layout (a tall hero pushes every block down), so
 * no height is assumed here. A block that is not on the page (or not measured yet) leaves the
 * page where it is, and the page never scrolls above its origin.
 */
export function detailScrollOffset(zone: DetailZone, tops: DetailBlockTops): number {
  if (zone === 'hero') return 0;
  const top = tops[zone];
  return top === undefined ? 0 : Math.max(0, top - SAFE_TOP);
}

const ZONE_ORDER: readonly DetailZone[] = ['hero', 'episodes', 'cast', 'boxSet', 'similar'];

/** Whether the block of `zone` lies above the block that holds the focus (it then fades out). */
export function isAbove(zone: DetailZone, focused: DetailZone): boolean {
  return ZONE_ORDER.indexOf(zone) < ZONE_ORDER.indexOf(focused);
}

/** An episode card: a 360x200 still with the title, the runtime and two lines of synopsis. */
export const EPISODE_CARD = { width: 360, height: 200 } as const;
export const EPISODE_STEP = EPISODE_CARD.width + CARD_GAP;
/** Space between the still and its caption. */
export const EPISODE_CAPTION_OFFSET = 14;
/** Title (31), runtime (26) and two synopsis lines (2 x 26). */
export const EPISODE_CAPTION_HEIGHT = 109;
export const EPISODE_STRIP_HEIGHT =
  EPISODE_CARD.height + EPISODE_CAPTION_OFFSET + EPISODE_CAPTION_HEIGHT + 2 * STRIP_PADDING;

/** The season pills (75 px tall, like every target) and the space below them. */
export const SEASON_PILLS_HEIGHT = 75;
export const SEASON_PILLS_GAP = 24;

/** Episode cards that fit across the screen between the insets, the next one only partly. */
export function episodesVisible(): number {
  return Math.floor((SCREEN_WIDTH - 2 * DETAIL_INSET + CARD_GAP) / EPISODE_STEP);
}
