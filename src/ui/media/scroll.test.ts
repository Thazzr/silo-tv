import { describe, expect, it } from 'vitest';
import { FocusIndexMemory, mountedIndices, nextScrollIndex } from './scroll';

describe('nextScrollIndex', () => {
  it('keeps the position while the focused item is on screen', () => {
    expect(nextScrollIndex(0, 3, 8, 21)).toBe(0);
    expect(nextScrollIndex(2, 9, 8, 21)).toBe(2);
  });

  it('scrolls just far enough to the right', () => {
    expect(nextScrollIndex(0, 8, 8, 21)).toBe(1);
    expect(nextScrollIndex(1, 12, 8, 21)).toBe(5);
  });

  it('scrolls back to the left when the focus returns before the first visible item', () => {
    expect(nextScrollIndex(5, 3, 8, 21)).toBe(3);
  });

  it('never scrolls past the last full screen', () => {
    expect(nextScrollIndex(0, 20, 8, 21)).toBe(13);
    expect(nextScrollIndex(0, 2, 8, 5)).toBe(0);
  });
});

describe('mountedIndices', () => {
  it('mounts the visible items with room on both sides', () => {
    expect(mountedIndices(5, 5, 8, 40, 2, 4)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it('clips at both ends', () => {
    expect(mountedIndices(0, 0, 8, 10, 2, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(mountedIndices(30, 30, 8, 40, 2, 4)).toEqual([
      28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    ]);
  });

  it('adds the focused item when it lies outside the window', () => {
    const indices = mountedIndices(0, 30, 8, 40, 2, 4);
    expect(indices).toContain(30);
    expect(indices).not.toContain(20);
  });
});

describe('FocusIndexMemory', () => {
  it('remembers an index per id and forgets on clear', () => {
    const memory = new FocusIndexMemory();
    expect(memory.get('a')).toBeUndefined();
    memory.set('a', 4);
    memory.set('b', 1);
    expect(memory.get('a')).toBe(4);
    memory.clear();
    expect(memory.get('a')).toBeUndefined();
    expect(memory.get('b')).toBeUndefined();
  });
});
