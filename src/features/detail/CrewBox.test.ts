import { describe, expect, it } from 'vitest';
import { revealScroll } from './CrewBox';

describe('revealScroll', () => {
  it('keeps the scroll while the focused name is in view with room to spare', () => {
    expect(revealScroll(0, 100, 500, 1000)).toBe(0);
    expect(revealScroll(300, 400, 800, 1000)).toBe(300);
  });

  it('scrolls right just far enough that the name ends 24 px before the edge', () => {
    expect(revealScroll(0, 1500, 1900, 1000)).toBe(924);
    // Already scrolled: only as far as needed.
    expect(revealScroll(900, 1500, 1900, 1000)).toBe(924);
  });

  it('scrolls left so the name starts 24 px after the edge, never past the start', () => {
    expect(revealScroll(924, 700, 1100, 1000)).toBe(676);
    expect(revealScroll(924, 10, 400, 1000)).toBe(0);
  });

  it('counts a name closer than 24 px to either edge as out of view', () => {
    expect(revealScroll(0, 0, 400, 1000)).toBe(0);
    expect(revealScroll(100, 110, 400, 1000)).toBe(86);
    expect(revealScroll(0, 700, 990, 1000)).toBe(14);
  });
});
