import { describe, expect, it } from 'vitest';
import { activeCues, sameCues } from './select';
import type { Cue } from './webvtt';

const cue = (start: number, end: number): Cue => ({
  start,
  end,
  lines: [[{ text: `${start}-${end}`, italic: false, bold: false, underline: false }]],
});

const a = cue(1, 4);
const b = cue(3, 6);
const c = cue(10, 12);
const cues = [a, b, c];

describe('activeCues', () => {
  it('shows a cue from its start up to but not including its end', () => {
    expect(activeCues(cues, 0.999)).toEqual([]);
    expect(activeCues(cues, 1)).toEqual([a]);
    expect(activeCues(cues, 3.999)).toEqual([a, b]);
    expect(activeCues(cues, 4)).toEqual([b]);
    expect(activeCues(cues, 6)).toEqual([]);
  });

  it('returns overlapping cues together, in start order', () => {
    expect(activeCues(cues, 3.5)).toEqual([a, b]);
  });

  it('finds a late cue after earlier ones have ended', () => {
    expect(activeCues(cues, 11)).toEqual([c]);
  });

  it('shifts the cues by the offset: positive later, negative earlier', () => {
    expect(activeCues(cues, 1, 500)).toEqual([]);
    expect(activeCues(cues, 1.5, 500)).toEqual([a]);
    expect(activeCues(cues, 4.4, 500)).toEqual([a, b]);
    expect(activeCues(cues, 9.5, -1000)).toEqual([c]);
    expect(activeCues(cues, 12, -1000)).toEqual([]);
  });
});

describe('sameCues', () => {
  it('is true for the same cue objects and false for any difference', () => {
    expect(sameCues([a, b], [a, b])).toBe(true);
    expect(sameCues([a, b], [a])).toBe(false);
    expect(sameCues([a, b], [a, c])).toBe(false);
    expect(sameCues([], [])).toBe(true);
  });
});
