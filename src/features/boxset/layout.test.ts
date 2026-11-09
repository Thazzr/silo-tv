import { describe, expect, it } from 'vitest';
import { BOXSET_GRID_TOP, boxSetScrollOffset } from './layout';

describe('boxSetScrollOffset', () => {
  it('leaves the page at its origin while the focus is in the hero', () => {
    expect(boxSetScrollOffset('top', 690)).toBe(0);
  });

  it('puts the measured top of the films block on the safe line while the focus is in the grid', () => {
    expect(boxSetScrollOffset('films', 690)).toBe(690 - 54);
    expect(boxSetScrollOffset('films', 820)).toBe(820 - 54);
  });

  it('does not scroll before the block is measured, or above the origin', () => {
    expect(boxSetScrollOffset('films', undefined)).toBe(0);
    expect(boxSetScrollOffset('films', 20)).toBe(0);
  });

  it('leaves 118 px above the grid when scrolled: safe line, heading, space', () => {
    expect(BOXSET_GRID_TOP).toBe(118);
  });
});
