import { describe, expect, it } from 'vitest';
import { rowHeight } from '../../ui/media';
import { fieldShift, SEARCH_GRID, searchScrollOffset } from './layout';

describe('the results grid', () => {
  it('fits four posters across the 1064 px of the results column', () => {
    expect(SEARCH_GRID.columns).toBe(4);
    expect(SEARCH_GRID.card).toEqual({ width: 236, height: 354 });
    expect(SEARCH_GRID.columns * SEARCH_GRID.card.width + 3 * SEARCH_GRID.gap).toBe(1064);
    // A row is the poster, its two caption lines and the gap to the next row.
    expect(SEARCH_GRID.rowPitch).toBe(354 + 16 + 57 + 57);
  });
});

describe('searchScrollOffset', () => {
  it('rests at the top while the focus is above the titles', () => {
    expect(searchScrollOffset('top', true, true)).toBe(0);
  });

  it('moves the rows of box sets and people out of the way for the titles', () => {
    expect(searchScrollOffset('grid', true, true)).toBe(rowHeight('poster') + rowHeight('person'));
    expect(searchScrollOffset('grid', true, false)).toBe(rowHeight('poster'));
    expect(searchScrollOffset('grid', false, true)).toBe(rowHeight('person'));
    expect(searchScrollOffset('grid', false, false)).toBe(0);
  });
});

describe('the compact people row', () => {
  it('is about 270 px high, so the titles stay in view under box sets and people', () => {
    expect(rowHeight('person')).toBeLessThanOrEqual(280);
    expect(rowHeight('person')).toBeLessThan(rowHeight('poster') * 0.7);
  });
});

describe('fieldShift', () => {
  it('does not move a text that fits the field', () => {
    expect(fieldShift(200, 500)).toBe(0);
    expect(fieldShift(500, 500)).toBe(0);
  });

  it('moves a wider text left by the part that does not fit, so its end stays in view', () => {
    expect(fieldShift(620, 500)).toBe(120);
    expect(fieldShift(500.4, 500)).toBe(1);
  });
});
