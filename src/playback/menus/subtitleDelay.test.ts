import { describe, expect, it } from 'vitest';
import {
  clampDelay,
  formatDelay,
  SUBTITLE_DELAY_STEP_MS,
  SUBTITLE_DELAY_WRITE_MS,
} from './subtitleDelay';

describe('formatDelay', () => {
  it.each([
    [300, '.', '+0.3 s'],
    [300, ',', '+0.3 s'.replace('.', ',')],
    [-1500, ',', '-1,5 s'],
    [0, '.', '0.0 s'],
    [10_000, '.', '+10.0 s'],
    [-10_000, '.', '-10.0 s'],
    [100, '.', '+0.1 s'],
    [-100, '.', '-0.1 s'],
  ])('writes %i ms with %j as %s', (ms, decimal, text) => {
    expect(formatDelay(ms, decimal)).toBe(text);
  });
});

describe('clampDelay', () => {
  it('keeps a value in range and clamps one past the contract bounds', () => {
    expect(clampDelay(300)).toBe(300);
    expect(clampDelay(10_000)).toBe(10_000);
    expect(clampDelay(10_100)).toBe(10_000);
    expect(clampDelay(-10_100)).toBe(-10_000);
    expect(clampDelay(12.6)).toBe(13);
  });
});

describe('the delay constants', () => {
  it('step 100 ms, written 600 ms after the last press', () => {
    expect(SUBTITLE_DELAY_STEP_MS).toBe(100);
    expect(SUBTITLE_DELAY_WRITE_MS).toBe(600);
  });
});
