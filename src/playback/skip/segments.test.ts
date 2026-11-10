/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeSegmentIndex, bandFractions, runsToEnd, segmentsOf, type Segment } from './segments';

const marker = (start_seconds: number, end_seconds: number) => ({ start_seconds, end_seconds });

describe('segmentsOf', () => {
  it('reads marker_segments in source-time order, a kind may occur more than once', () => {
    const segments = segmentsOf(
      {
        marker_segments: [
          { kind: 'credits', start_seconds: 3000, end_seconds: 3100 },
          { kind: 'intro', start_seconds: 10, end_seconds: 60 },
          { kind: 'intro', start_seconds: 1500, end_seconds: 1550 },
        ],
        // Ignored while the server sends the list.
        recap: marker(0, 5),
      },
      true,
    );
    expect(segments).toEqual([
      { kind: 'intro', start: 10, end: 60 },
      { kind: 'intro', start: 1500, end: 1550 },
      { kind: 'credits', start: 3000, end: 3100 },
    ]);
  });

  it('reads the singular fields of an older server, and ignores the list then', () => {
    const segments = segmentsOf(
      {
        marker_segments: [{ kind: 'preview', start_seconds: 1, end_seconds: 2 }],
        intro: marker(30, 90),
        recap: marker(0, 20),
        credits: marker(5000, 5400),
      },
      false,
    );
    expect(segments).toEqual([
      { kind: 'recap', start: 0, end: 20 },
      { kind: 'intro', start: 30, end: 90 },
      { kind: 'credits', start: 5000, end: 5400 },
    ]);
  });

  it('drops markers without a usable range, and gives nothing without data', () => {
    expect(
      segmentsOf(
        {
          marker_segments: [
            { kind: 'intro', start_seconds: 50, end_seconds: 50 },
            { kind: 'intro', start_seconds: 60, end_seconds: 10 },
            { kind: 'intro', start_seconds: Number.NaN, end_seconds: 10 },
          ],
        },
        true,
      ),
    ).toEqual([]);
    expect(segmentsOf({}, true)).toEqual([]);
    expect(segmentsOf({}, false)).toEqual([]);
  });
});

describe('activeSegmentIndex', () => {
  const segments: Segment[] = [
    { kind: 'intro', start: 10, end: 60 },
    { kind: 'intro', start: 100, end: 160 },
  ];

  it('holds its start and releases its end', () => {
    expect(activeSegmentIndex(segments, 9.99)).toBe(-1);
    expect(activeSegmentIndex(segments, 10)).toBe(0);
    expect(activeSegmentIndex(segments, 59.99)).toBe(0);
    expect(activeSegmentIndex(segments, 60)).toBe(-1);
  });

  it('finds the right one of several of a kind', () => {
    expect(activeSegmentIndex(segments, 120)).toBe(1);
  });
});

describe('runsToEnd', () => {
  const credits: Segment = { kind: 'credits', start: 5300, end: 5399 };

  it('is true when the end is within 2 s of the duration', () => {
    expect(runsToEnd(credits, 5400)).toBe(true);
    expect(runsToEnd({ ...credits, end: 5398 }, 5400)).toBe(true);
  });

  it('is false further from the end, and without a duration', () => {
    expect(runsToEnd({ ...credits, end: 5397.9 }, 5400)).toBe(false);
    expect(runsToEnd(credits, 0)).toBe(false);
  });
});

describe('bandFractions', () => {
  it('maps intro, recap and credits to fractions of the track, not the preview', () => {
    expect(
      bandFractions(
        [
          { kind: 'recap', start: 0, end: 540 },
          { kind: 'intro', start: 540, end: 1080 },
          { kind: 'preview', start: 2000, end: 2100 },
          { kind: 'credits', start: 4860, end: 5400 },
        ],
        5400,
      ),
    ).toEqual([
      { start: 0, end: 0.1 },
      { start: 0.1, end: 0.2 },
      { start: 0.9, end: 1 },
    ]);
  });

  it('draws nothing without a duration', () => {
    expect(bandFractions([{ kind: 'intro', start: 0, end: 10 }], 0)).toEqual([]);
  });
});

describe('texts', () => {
  const keys = ['intro', 'recap', 'credits', 'preview', 'watchIntro'].map(
    (k) => `player.skip.${k}`,
  );
  for (const lang of ['de', 'en']) {
    it(`${lang}.json has every pill text`, () => {
      const table = JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf-8')) as Record<
        string,
        string
      >;
      for (const key of keys) expect(table[key], key).toBeTruthy();
    });
  }
});
