// Sizes of the media cards, rows and grids (docs/design.md). All values are CSS pixels on the
// 1920x1080 layout. The rows and the grid position their cards from these numbers instead of
// measuring the DOM, so the scroll offsets and the mounted windows are plain arithmetic.

export type CardShape = 'poster' | 'landscape' | 'person';

/** Poster 176x264 and landscape 360x200 in rows; posters grow to 260x390 in browse grids. */
export const CARD_SIZE: Record<CardShape, { width: number; height: number }> = {
  poster: { width: 176, height: 264 },
  landscape: { width: 360, height: 200 },
  /** A round portrait of 128 px in a 150 px column; the name goes under it (Search's people row). */
  person: { width: 150, height: 128 },
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
const CAPTION_OFFSET: Record<CardShape, number> = { poster: 22, landscape: 14, person: 8 };
/** A person's name takes up to two lines of 20 px / 26 px. */
const PERSON_CAPTION_HEIGHT = 52;

export const ROW_TITLE_HEIGHT = 48;
/** Padding above and below the strip, so the focused card's scale and shadow are not clipped. */
export const STRIP_PADDING = 14;
export const ROW_SPACING = 10;

/**
 * The size of a row's cards: the art, the space under it and the caption. A shape stands for its
 * usual numbers; a row of other cards (the episode row of an episode's page) passes its own.
 */
export interface CardMetrics {
  width: number;
  height: number;
  /** Space between the art and its caption. */
  captionOffset: number;
  captionHeight: number;
}

function metricsOf(shape: CardShape | CardMetrics): CardMetrics {
  if (typeof shape !== 'string') return shape;
  return {
    ...CARD_SIZE[shape],
    captionOffset: CAPTION_OFFSET[shape],
    captionHeight: shape === 'person' ? PERSON_CAPTION_HEIGHT : CAPTION_HEIGHT,
  };
}

/** Cards that fit across the screen between the insets, the next one only partly. */
export function rowVisibleCards(shape: CardShape | CardMetrics): number {
  const step = metricsOf(shape).width + CARD_GAP;
  return Math.floor((SCREEN_WIDTH - 2 * ROW_INSET + CARD_GAP) / step);
}

/** Distance between the left edges of two neighbouring cards. */
export function rowStep(shape: CardShape | CardMetrics): number {
  return metricsOf(shape).width + CARD_GAP;
}

export function captionOffset(shape: CardShape): number {
  return CAPTION_OFFSET[shape];
}

/** Art plus caption: what a card needs in height. */
export function cardBlockHeight(shape: CardShape | CardMetrics): number {
  const m = metricsOf(shape);
  return m.height + m.captionOffset + m.captionHeight;
}

/** The whole row: header, padded strip and the space to the next row. */
export function rowHeight(shape: CardShape | CardMetrics): number {
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

/** How a grid places its cards: the browse grid's numbers by default, a narrower one for Search. */
export interface GridMetrics {
  columns: number;
  card: { width: number; height: number };
  /** Space between two columns. */
  gap: number;
  /** Left inset of the first column inside the grid's viewport. */
  inset: number;
  /** Distance between the tops of two grid rows. */
  rowPitch: number;
}

/** A grid of `columns` posters of `card` size; the row pitch adds the caption and the row gap. */
export function gridMetrics(
  columns: number,
  card: { width: number; height: number },
  gap: number,
  inset: number,
): GridMetrics {
  return {
    columns,
    card,
    gap,
    inset,
    rowPitch: card.height + GRID_CAPTION_OFFSET + CAPTION_HEIGHT + GRID_ROW_GAP,
  };
}

export const DEFAULT_GRID: GridMetrics = {
  columns: GRID_COLUMNS,
  card: GRID_CARD_SIZE,
  gap: CARD_GAP,
  inset: ROW_INSET,
  rowPitch: GRID_ROW_PITCH,
};
