import { describe, expect, it } from 'vitest';
import {
  DETAIL_INSET,
  DETAIL_SCROLLED_DIM_ALPHA,
  DETAIL_SHADE_MIN_ALPHA,
  DETAIL_TEXT_WIDTH,
  EPISODE_GRID,
  EPISODE_ROW_CARD,
  SAFE_TOP,
  SEASON_CARD,
  SEASON_STEP,
  SEASON_STRIP_HEIGHT,
  detailScrollOffset,
  isAbove,
  seasonsVisible,
} from './layout';
import { SCREEN_WIDTH, rowVisibleCards } from '../../ui/media';

describe('detailScrollOffset', () => {
  it('scrolls a block to the safe line: its measured top minus 54', () => {
    expect(SAFE_TOP).toBe(54);
    // A tall hero (logo, four lines, credits) pushes the seasons block to 812 px.
    expect(detailScrollOffset('episodes', { episodes: 812 })).toBe(758);
    expect(detailScrollOffset('episodes', { episodes: 760 })).toBe(706);
    expect(detailScrollOffset('cast', { cast: 760, similar: 1180 })).toBe(706);
    expect(detailScrollOffset('similar', { cast: 760, similar: 1180 })).toBe(1126);
    expect(detailScrollOffset('extras', { cast: 760, extras: 1000 })).toBe(946);
    expect(detailScrollOffset('similar', { episodes: 812, similar: 1424 })).toBe(1370);
  });

  it('keeps the hero at the origin whatever is measured', () => {
    expect(detailScrollOffset('hero', { episodes: 812 })).toBe(0);
    expect(detailScrollOffset('hero', {})).toBe(0);
  });

  it('leaves the page at the origin for a block that is missing or not yet measured', () => {
    expect(detailScrollOffset('episodes', {})).toBe(0);
    expect(detailScrollOffset('similar', { cast: 760 })).toBe(0);
    // Never above the origin, even for a block that starts within the safe area.
    expect(detailScrollOffset('cast', { cast: 20 })).toBe(0);
  });
});

describe('the seasons row and the episode grid', () => {
  it('scrolls the seasons block to the safe line like any other block', () => {
    expect(detailScrollOffset('seasons', { seasons: 812 })).toBe(758);
    expect(detailScrollOffset('seasons', { episodes: 812 })).toBe(0);
  });

  it('puts the seasons row above the episode grid and both above the cast', () => {
    expect(isAbove('hero', 'seasons')).toBe(true);
    expect(isAbove('seasons', 'episodes')).toBe(true);
    expect(isAbove('seasons', 'cast')).toBe(true);
    expect(isAbove('episodes', 'seasons')).toBe(false);
    expect(isAbove('seasons', 'seasons')).toBe(false);
  });

  it('draws season posters of 220 x 330, 260 px apart, six and a bit across', () => {
    expect(SEASON_CARD).toEqual({ width: 220, height: 330 });
    expect(SEASON_STEP).toBe(260);
    expect(seasonsVisible()).toBe(6);
    // Poster, 22 px, the 57 px caption and the 14 px padding above and below.
    expect(SEASON_STRIP_HEIGHT).toBe(437);
  });

  it('fills the width between the insets with five stills, 16:9, 25 px apart', () => {
    const { columns, card, gap, inset, rowPitch } = EPISODE_GRID;
    expect(inset).toBe(DETAIL_INSET);
    expect(columns * card.width + (columns - 1) * gap).toBe(SCREEN_WIDTH - 2 * DETAIL_INSET);
    expect(Math.abs(card.width / card.height - 16 / 9)).toBeLessThan(0.01);
    // Still, 14 px, three caption lines of 31 + 26 + 78 px, a 40 px gap between the rows.
    expect(rowPitch).toBe(182 + 14 + 135 + 40);
  });
});

describe('the More Episodes row', () => {
  it('draws 330 x 186 stills (16:9) with the grid caption under them, four and a bit across', () => {
    expect(EPISODE_ROW_CARD.width).toBe(330);
    expect(EPISODE_ROW_CARD.height).toBe(186);
    expect(EPISODE_ROW_CARD.captionHeight).toBe(
      EPISODE_GRID.rowPitch - EPISODE_GRID.card.height - EPISODE_ROW_CARD.captionOffset - 40,
    );
    expect(rowVisibleCards(EPISODE_ROW_CARD)).toBe(4);
  });
});

describe('isAbove', () => {
  it('is true for every block above the focused one', () => {
    expect(isAbove('hero', 'episodes')).toBe(true);
    expect(isAbove('hero', 'similar')).toBe(true);
    expect(isAbove('cast', 'similar')).toBe(true);
    expect(isAbove('episodes', 'similar')).toBe(true);
  });

  it('is false for the focused block, the ones below it and the hero while it is focused', () => {
    expect(isAbove('hero', 'hero')).toBe(false);
    expect(isAbove('episodes', 'episodes')).toBe(false);
    expect(isAbove('similar', 'cast')).toBe(false);
    expect(isAbove('similar', 'hero')).toBe(false);
  });

  it('puts the extras row after the cast and the episodes and before the box set', () => {
    expect(isAbove('cast', 'extras')).toBe(true);
    expect(isAbove('episodes', 'extras')).toBe(true);
    expect(isAbove('extras', 'boxSet')).toBe(true);
    expect(isAbove('extras', 'similar')).toBe(true);
    expect(isAbove('boxSet', 'extras')).toBe(false);
    expect(isAbove('extras', 'extras')).toBe(false);
  });

  it('puts the box set row between the cast and the similar titles', () => {
    expect(isAbove('cast', 'boxSet')).toBe(true);
    expect(isAbove('boxSet', 'similar')).toBe(true);
    expect(isAbove('similar', 'boxSet')).toBe(false);
    expect(isAbove('boxSet', 'boxSet')).toBe(false);
  });
});

describe('hero text column', () => {
  const luminance = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  it('ends before 1000 px', () => {
    expect(DETAIL_INSET + DETAIL_TEXT_WIDTH).toBeLessThanOrEqual(1000);
  });

  it('keeps the secondary text at 4.5:1 over a white backdrop under the weakest shade', () => {
    const backdrop = 255 * (1 - DETAIL_SHADE_MIN_ALPHA);
    // --text-secondary is rgba(237, 237, 237, 0.6).
    const text = 0.6 * 237 + 0.4 * backdrop;
    expect(contrast(luminance(text), luminance(backdrop))).toBeGreaterThanOrEqual(4.5);
  });

  it('dims the backdrop to at least 0.85 black once scrolled, so text keeps 4.5:1 anywhere', () => {
    expect(DETAIL_SCROLLED_DIM_ALPHA).toBeGreaterThanOrEqual(0.85);
    const backdrop = 255 * (1 - DETAIL_SCROLLED_DIM_ALPHA);
    const text = 0.6 * 237 + 0.4 * backdrop;
    expect(contrast(luminance(text), luminance(backdrop))).toBeGreaterThanOrEqual(4.5);
    // The stylesheet draws exactly that alpha; e2e/flow.spec.ts checks the computed colour.
  });
});
