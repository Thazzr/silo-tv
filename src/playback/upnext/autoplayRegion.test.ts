import { describe, expect, it } from 'vitest';
import type { Segment } from '../skip/segments';
import { autoplayRegion } from './autoplayRegion';

const seg = (kind: Segment['kind'], start: number, end: number): Segment => ({ kind, start, end });

describe('autoplayRegion', () => {
  it('runs from the start of the credits to the end of the title', () => {
    expect(autoplayRegion([seg('credits', 2400, 2700)], 2700, false)).toEqual({
      start: 2400,
      end: 2700,
    });
  });

  it('has no region without a duration', () => {
    expect(autoplayRegion([seg('credits', 2400, 2700)], 0, false)).toBeNull();
  });

  it('has no region without credits, and intros and recaps never count', () => {
    expect(autoplayRegion([], 2700, false)).toBeNull();
    expect(autoplayRegion([seg('intro', 10, 70), seg('recap', 0, 9)], 2700, true)).toBeNull();
  });

  it('has no region when a scene follows the credits', () => {
    expect(autoplayRegion([seg('credits', 2400, 2600)], 2700, false)).toBeNull();
  });

  it('allows a second of rounding between the credits and the end', () => {
    expect(autoplayRegion([seg('credits', 2400, 2699.2)], 2700, false)).toEqual({
      start: 2400,
      end: 2700,
    });
    expect(autoplayRegion([seg('credits', 2400, 2698.9)], 2700, false)).toBeNull();
  });

  it('counts a preview only when the profile allows it', () => {
    const segments = [seg('credits', 2400, 2600), seg('preview', 2600, 2700)];
    expect(autoplayRegion(segments, 2700, false)).toBeNull();
    expect(autoplayRegion(segments, 2700, true)).toEqual({ start: 2400, end: 2700 });
  });

  it('starts at the preview when only that reaches the end', () => {
    expect(autoplayRegion([seg('preview', 2600, 2700)], 2700, true)).toEqual({
      start: 2600,
      end: 2700,
    });
  });

  it('does not span a gap between markers', () => {
    const segments = [seg('credits', 100, 200), seg('credits', 2400, 2700)];
    expect(autoplayRegion(segments, 2700, false)).toEqual({ start: 2400, end: 2700 });
  });

  it('chains markers that touch back to the first of the chain', () => {
    const segments = [seg('credits', 2300, 2500), seg('credits', 2500, 2700)];
    expect(autoplayRegion(segments, 2700, false)).toEqual({ start: 2300, end: 2700 });
  });
});
