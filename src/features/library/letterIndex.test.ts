import { describe, expect, it } from 'vitest';
import { jumpPosition, letterAtIndex } from './letterIndex';

const RUNS = [
  { letter: 'A', position: 0 },
  { letter: 'C', position: 10 },
  { letter: 'D', position: 20 },
  // The collation put some of the C titles after the D ones.
  { letter: 'C', position: 30 },
];

describe('letterAtIndex', () => {
  it('is the letter of the last run that starts at or before the position', () => {
    expect(letterAtIndex(RUNS, 0)).toBe('A');
    expect(letterAtIndex(RUNS, 9)).toBe('A');
    expect(letterAtIndex(RUNS, 10)).toBe('C');
    expect(letterAtIndex(RUNS, 29)).toBe('D');
    expect(letterAtIndex(RUNS, 30)).toBe('C');
    expect(letterAtIndex(RUNS, 999)).toBe('C');
  });

  it('is undefined without runs', () => {
    expect(letterAtIndex([], 0)).toBeUndefined();
  });

  it('is undefined before the first run', () => {
    expect(letterAtIndex([{ letter: 'B', position: 5 }], 4)).toBeUndefined();
  });
});

describe('jumpPosition', () => {
  it('is the start of the first run of the letter, also when it has two', () => {
    expect(jumpPosition(RUNS, 'C')).toBe(10);
    expect(jumpPosition(RUNS, 'D')).toBe(20);
  });

  it('is undefined for a letter without a run', () => {
    expect(jumpPosition(RUNS, 'Z')).toBeUndefined();
  });
});
