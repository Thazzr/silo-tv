import { describe, expect, it } from 'vitest';
import {
  clampDelay,
  formatDelay,
  SUBTITLE_DELAY_STEP_MS,
  SUBTITLE_DELAY_WRITE_MS,
} from './subtitleDelay';

describe('formatDelay', () => {
  it.each([
    [0, '0 ms'],
    [300, '+300 ms'],
    [100, '+100 ms'],
    [10_000, '+10000 ms'],
    [-100, '−100 ms'],
    [-10_000, '−10000 ms'],
  ])('writes %i ms as %s', (ms, text) => {
    expect(formatDelay(ms)).toBe(text);
  });

  it('uses the real minus sign U+2212, never a hyphen', () => {
    expect(formatDelay(-300).charCodeAt(0)).toBe(0x2212);
    expect(formatDelay(-300)).not.toContain('-');
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
