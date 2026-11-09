// Sizes of the media cards, rows and grids (docs/design.md). All values are CSS pixels on the
// 1920x1080 layout. The rows and the grid position their cards from these numbers instead of
// measuring the DOM, so the scroll offsets and the mounted windows are plain arithmetic.

export type CardShape = 'poster' | 'landscape';

/** Poster 176x264 and landscape 360x200 in rows; posters grow to 260x390 in browse grids. */
export const CARD_SIZE: Record<CardShape, { width: number; height: number }> = {
  poster: { width: 176, height: 264 },
  landscape: { width: 360, height: 200 },
};
export const GRID_CARD_SIZE = { width: 260, height: 390 } as const;

export const CARD_GAP = 40;
/** Left inset of row headers, rows and grids. */
export const ROW_INSET = 80;
/** The screen's width; the rows fit as many whole cards into it as they can. */
export const SCREEN_WIDTH = 1920;

/** Two caption lines: the title (24 px) and the second line (20 px). */
export const CAPTION_HEIGHT = 57;
/** Space between the art and its caption; the focused art grows a little into it. */
const CAPTION_OFFSET: Record<CardShape, number> = { poster: 22, landscape: 14 };

export const ROW_TITLE_HEIGHT = 48;
/** Padding above and below the strip, so the focused card's scale and shadow are not clipped. */
export const STRIP_PADDING = 14;
export const ROW_SPACING = 10;

/** Cards that fit across the screen between the insets, the next one only partly. */
export function rowVisibleCards(shape: CardShape): number {
  const step = CARD_SIZE[shape].width + CARD_GAP;
  return Math.floor((SCREEN_WIDTH - 2 * ROW_INSET + CARD_GAP) / step);
}

/** Distance between the left edges of two neighbouring cards. */
export function rowStep(shape: CardShape): number {
  return CARD_SIZE[shape].width + CARD_GAP;
}

export function captionOffset(shape: CardShape): number {
  return CAPTION_OFFSET[shape];
}

/** Art plus caption: what a card needs in height. */
export function cardBlockHeight(shape: CardShape): number {
  return CARD_SIZE[shape].height + CAPTION_OFFSET[shape] + CAPTION_HEIGHT;
}

/** The whole row: header, padded strip and the space to the next row. */
export function rowHeight(shape: CardShape): number {
  return ROW_TITLE_HEIGHT + 2 * STRIP_PADDING + cardBlockHeight(shape) + ROW_SPACING;
}

/** The compact inline error that replaces a row that failed to load. */
export const ROW_ERROR_HEIGHT = ROW_TITLE_HEIGHT + 2 * STRIP_PADDING + 75 + ROW_SPACING;

export const GRID_COLUMNS = 6;
const GRID_CAPTION_OFFSET = 16;
const GRID_ROW_GAP = 57;
/** Distance between the tops of two grid rows. */
export const GRID_ROW_PITCH =
  GRID_CARD_SIZE.height + GRID_CAPTION_OFFSET + CAPTION_HEIGHT + GRID_ROW_GAP;
export const GRID_CAPTION_GAP = GRID_CAPTION_OFFSET;
