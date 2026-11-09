// Sizes of the detail page (docs/design.md). All values are CSS pixels on the 1920x1080 layout and
// must match src/styles/detail.css. The page scrolls in steps from one section to the next, so the
// offsets are plain arithmetic on these heights.
import { CARD_GAP, SCREEN_WIDTH, STRIP_PADDING } from '../../ui/media';

/** Side inset of the detail pages. */
export const DETAIL_INSET = 100;
/** The hero: backdrop, title, facts, synopsis and the action row. */
export const HERO_HEIGHT = 760;
/** The hero's text column (title, facts, synopsis, credits), from the inset to 1000 px. */
export const DETAIL_TEXT_WIDTH = 900;
/**
 * The least opacity of black over the backdrop under the text column; src/styles/detail.css draws
 * at least this (0.92 up to 1075 px). A white backdrop then shows as #141414 or darker.
 */
export const DETAIL_SHADE_MIN_ALPHA = 0.92;

/** The top of the safe area (5 % of 1080 px): scrolled-to blocks start on this line. */
export const SAFE_TOP = 54;

/** The blocks of the page the view snaps between. */
export type DetailZone = 'hero' | 'episodes' | 'cast' | 'similar';
/** A block below the hero, in page order, with its height. */
export interface DetailSection {
  zone: Exclude<DetailZone, 'hero'>;
  height: number;
}

/**
 * How far the page is scrolled while the focus is in `zone`: the hero stays at the origin, and any
 * other block is scrolled so its first line (the season pills, a row's title) sits on the top
 * safe-area line. The block above, with its focusable buttons, is then out of view and nothing is
 * cut off at the top edge.
 */
export function detailScrollOffset(zone: DetailZone, sections: readonly DetailSection[]): number {
  if (zone === 'hero') return 0;
  let top = HERO_HEIGHT;
  for (const section of sections) {
    if (section.zone === zone) break;
    top += section.height;
  }
  return top - SAFE_TOP;
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
export const EPISODES_SECTION_HEIGHT =
  SEASON_PILLS_HEIGHT + SEASON_PILLS_GAP + EPISODE_STRIP_HEIGHT + 30;

/** Episode cards that fit across the screen between the insets, the next one only partly. */
export function episodesVisible(): number {
  return Math.floor((SCREEN_WIDTH - 2 * DETAIL_INSET + CARD_GAP) / EPISODE_STEP);
}
