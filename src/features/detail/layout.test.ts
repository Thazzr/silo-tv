import { describe, expect, it } from 'vitest';
import {
  DETAIL_INSET,
  DETAIL_SCROLLED_DIM_ALPHA,
  DETAIL_SHADE_MIN_ALPHA,
  DETAIL_TEXT_WIDTH,
  SAFE_TOP,
  detailScrollOffset,
  isAbove,
} from './layout';

describe('detailScrollOffset', () => {
  it('scrolls a block to the safe line: its measured top minus 54', () => {
    expect(SAFE_TOP).toBe(54);
    // A tall hero (logo, four lines, credits) pushes the seasons block to 812 px.
    expect(detailScrollOffset('episodes', { episodes: 812 })).toBe(758);
    expect(detailScrollOffset('episodes', { episodes: 760 })).toBe(706);
    expect(detailScrollOffset('cast', { cast: 760, similar: 1180 })).toBe(706);
    expect(detailScrollOffset('similar', { cast: 760, similar: 1180 })).toBe(1126);
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
