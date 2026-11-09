import { describe, expect, it } from 'vitest';
import { rowHeight } from '../../ui/media';
import {
  DETAIL_INSET,
  DETAIL_SHADE_MIN_ALPHA,
  DETAIL_TEXT_WIDTH,
  EPISODES_SECTION_HEIGHT,
  HERO_HEIGHT,
  SAFE_TOP,
  detailScrollOffset,
  type DetailSection,
} from './layout';

const SCREEN_HEIGHT = 1080;
const series: DetailSection[] = [
  { zone: 'episodes', height: EPISODES_SECTION_HEIGHT },
  { zone: 'similar', height: rowHeight('poster') },
];
const movie: DetailSection[] = [
  { zone: 'cast', height: rowHeight('poster') },
  { zone: 'similar', height: rowHeight('poster') },
];

describe('detailScrollOffset', () => {
  it('pins the literal geometry: safe line 54, hero 760', () => {
    expect(SAFE_TOP).toBe(54);
    expect(HERO_HEIGHT).toBe(760);
    expect(detailScrollOffset('episodes', series)).toBe(706);
    expect(detailScrollOffset('cast', movie)).toBe(706);
    expect(detailScrollOffset('similar', movie)).toBe(760 + rowHeight('poster') - 54);
    expect(detailScrollOffset('similar', [{ zone: 'similar', height: 400 }])).toBe(706);
  });

  it('keeps the hero at the origin', () => {
    expect(detailScrollOffset('hero', series)).toBe(0);
    expect(detailScrollOffset('hero', movie)).toBe(0);
  });

  it('puts the season pills on the top safe-area line for the pills and the episodes', () => {
    expect(detailScrollOffset('episodes', series)).toBe(HERO_HEIGHT - SAFE_TOP);
  });

  it('puts a lower row at the top safe-area line, below the blocks above it', () => {
    expect(detailScrollOffset('similar', series)).toBe(
      HERO_HEIGHT + EPISODES_SECTION_HEIGHT - SAFE_TOP,
    );
    expect(detailScrollOffset('cast', movie)).toBe(HERO_HEIGHT - SAFE_TOP);
    expect(detailScrollOffset('similar', movie)).toBe(HERO_HEIGHT + rowHeight('poster') - SAFE_TOP);
  });

  it('shows the whole cast row, names included, inside the safe area', () => {
    const bottom = HERO_HEIGHT + rowHeight('poster') - detailScrollOffset('cast', movie);
    expect(bottom).toBeLessThanOrEqual(SCREEN_HEIGHT - SAFE_TOP);
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
});
