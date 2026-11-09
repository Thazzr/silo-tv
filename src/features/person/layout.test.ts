import { describe, expect, it } from 'vitest';
import { GRID_TOP, personScrollOffset } from './layout';

describe('personScrollOffset', () => {
  it('leaves the page at its origin while the focus is at the top', () => {
    expect(personScrollOffset('top', 640)).toBe(0);
  });

  it('puts the measured top of the pills on the safe line while the focus is in the grid', () => {
    expect(personScrollOffset('grid', 640)).toBe(640 - 54);
    expect(personScrollOffset('grid', 800)).toBe(800 - 54);
  });

  it('does not scroll before the pills are measured, or above the origin', () => {
    expect(personScrollOffset('grid', undefined)).toBe(0);
    expect(personScrollOffset('grid', 20)).toBe(0);
  });

  it('leaves 141 px above the grid when scrolled: safe line, pills, space', () => {
    expect(GRID_TOP).toBe(141);
  });
});
