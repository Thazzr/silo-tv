// Sizes of the detail page (docs/design.md). All values are CSS pixels on the 1920x1080 layout and
// must match src/styles/detail.css. The page scrolls in steps from one section to the next, so the
// offsets are plain arithmetic on these heights.
import { CARD_GAP, SCREEN_WIDTH, STRIP_PADDING } from '../../ui/media';

/** Side inset of the detail pages. */
export const DETAIL_INSET = 100;
/** The hero: backdrop, title, facts, synopsis and the action row. */
export const HERO_HEIGHT = 760;
/** How much of the page above a section stays visible when the page scrolls to it. */
export const SECTION_TOP_MARGIN = 40;

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
