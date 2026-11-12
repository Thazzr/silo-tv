// Sizes of the detail page (docs/design.md). All values are CSS pixels on the 1920x1080 layout and
// must match src/styles/detail.css. The page scrolls in steps from one section to the next; the
// offsets come from the measured block tops, not from heights kept here.
import {
  CARD_GAP,
  SCREEN_WIDTH,
  STRIP_PADDING,
  type CardMetrics,
  type GridMetrics,
} from '../../ui/media';
import type { DetailKind } from './info';

/** Side inset of the detail pages. */
export const DETAIL_INSET = 100;
/** The least height of the hero; it grows with its text column (logo, synopsis, credits, actions). */
export const HERO_HEIGHT = 760;
/** The hero's text column (title, facts, synopsis, credits), from the inset to 1000 px. */
export const DETAIL_TEXT_WIDTH = 900;
/**
 * The least opacity of black over the backdrop under the text column; src/styles/detail.css draws
 * at least this (0.92 up to 66 % of the width, past the end of a movie's or series' text column).
 * A white backdrop then shows as #141414 or darker.
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
export type DetailZone =
  'hero' | 'seasons' | 'episodes' | 'extras' | 'trailers' | 'cast' | 'crew' | 'boxSet' | 'similar';
/** The zones below the hero, which have a block of their own to scroll to. */
export type DetailBlockZone = Exclude<DetailZone, 'hero'>;
/** The measured top of each block below the hero inside the page (layout position, in px). */
export type DetailBlockTops = Partial<Record<DetailBlockZone, number>>;

/**
 * How far the page is scrolled while the focus is in `zone`: the hero stays at the origin, and any
 * other block is scrolled so its first line (a row's or a grid's heading) sits on the top
 * safe-area line. The tops are measured from the layout (a tall hero pushes every block down), so
 * no height is assumed here. A block that is not on the page (or not measured yet) leaves the
 * page where it is, and the page never scrolls above its origin.
 */
export function detailScrollOffset(zone: DetailZone, tops: DetailBlockTops): number {
  if (zone === 'hero') return 0;
  const top = tops[zone];
  return top === undefined ? 0 : Math.max(0, top - SAFE_TOP);
}

/**
 * The blocks of a page in the order the web draws them (docs/roadmap.md, Detail pages): a movie
 * leads with its cast, a series with its seasons and the extras, a season and an episode end with
 * the cast and the crew. A block that is not on the page is simply never focused.
 */
export function zoneOrder(kind: DetailKind): readonly DetailZone[] {
  switch (kind) {
    case 'item':
      return ['hero', 'cast', 'extras', 'trailers', 'boxSet', 'similar'];
    case 'series':
      return ['hero', 'seasons', 'episodes', 'extras', 'trailers', 'cast', 'similar'];
    case 'season':
    case 'episode':
      return ['hero', 'episodes', 'cast', 'crew'];
  }
}

/** Whether the block of `zone` lies above the block that holds the focus (it then fades out). */
export function isAbove(
  zone: DetailZone,
  focused: DetailZone,
  order: readonly DetailZone[],
): boolean {
  return order.indexOf(zone) < order.indexOf(focused);
}

/** A season card: a 220x330 poster (the web's 140x210, scaled) with its label and episode count. */
export const SEASON_CARD = { width: 220, height: 330 } as const;
export const SEASON_STEP = SEASON_CARD.width + CARD_GAP;
/** Space between the poster and its caption. */
export const SEASON_CAPTION_OFFSET = 22;
/** Label (31) and episode count (26). */
export const SEASON_CAPTION_HEIGHT = 57;
export const SEASON_STRIP_HEIGHT =
  SEASON_CARD.height + SEASON_CAPTION_OFFSET + SEASON_CAPTION_HEIGHT + 2 * STRIP_PADDING;
/** The heading line of the seasons row and of the episode grid ("Seasons", "N total"). */
export const SECTION_HEAD_HEIGHT = 48;

/** Season cards that fit across the screen between the insets, the next one only partly. */
export function seasonsVisible(): number {
  return Math.floor((SCREEN_WIDTH - 2 * DETAIL_INSET + CARD_GAP) / SEASON_STEP);
}

/**
 * The episode grid: five columns of 324x182 stills (16:9) between the insets, 25 px apart. A card's
 * caption sits 14 px under the still: the code and title (31), the date and runtime (26) and three
 * lines of synopsis (3 x 26) make 135 px; 40 px separate the rows. src/styles/detail.css draws
 * the same numbers.
 */
export const EPISODE_CARD = { width: 324, height: 182 } as const;
const EPISODE_CAPTION_OFFSET = 14;
const EPISODE_CAPTION_HEIGHT = 135;
const EPISODE_ROW_GAP = 40;
export const EPISODE_GRID: GridMetrics = {
  columns: 5,
  card: EPISODE_CARD,
  gap: 25,
  inset: DETAIL_INSET,
  rowPitch: EPISODE_CARD.height + EPISODE_CAPTION_OFFSET + EPISODE_CAPTION_HEIGHT + EPISODE_ROW_GAP,
};

/**
 * The cards of the "More Episodes" row on an episode's page: the web's 240 px stills scaled up to
 * 330 x 186 (16:9), with the grid's caption under them. src/styles/detail.css draws the same numbers.
 */
export const EPISODE_ROW_CARD: CardMetrics = {
  width: 330,
  height: 186,
  captionOffset: EPISODE_CAPTION_OFFSET,
  captionHeight: EPISODE_CAPTION_HEIGHT,
};
