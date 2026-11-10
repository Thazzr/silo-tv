import { describe, expect, it } from 'vitest';
import type { components } from '../../api/generated/schema';
import {
  cardLeft,
  CARD_WIDTH_PLAIN,
  CARD_WIDTH_WITH_IMAGE,
  chapterAt,
  chapterTickFractions,
  chapterTitleAt,
  resolveSheetUrl,
  THUMB_DISPLAY_WIDTH,
  thumbnailBox,
  tileIndex,
  tilePosition,
  toChapters,
  type Chapter,
  type TrickplayManifest,
} from './previewMath';

/** 5400 s at one thumbnail per 10 s: 540 thumbnails on 6 sheets of 10x10, the last one 40 full. */
const manifest: TrickplayManifest = {
  expires_at: '2030-01-01T00:00:00.000Z',
  file_id: 'file-1',
  interval_ms: 10_000,
  sheets: [0, 1, 2, 3, 4, 5].map((index) => ({ index, url: `/sheet/${index}.jpg` })),
  thumbnail_count: 540,
  thumbnail_height: 126,
  thumbnail_width: 300,
  tile_columns: 10,
  tile_rows: 10,
};

describe('tileIndex', () => {
  it('maps the start to thumbnail 0', () => {
    expect(tileIndex(0, manifest)).toBe(0);
    expect(tileIndex(9.99, manifest)).toBe(0);
  });

  it('maps the middle by the interval', () => {
    expect(tileIndex(10, manifest)).toBe(1);
    expect(tileIndex(2700, manifest)).toBe(270);
  });

  it('maps the last thumbnail, and clamps beyond the end and before the start', () => {
    expect(tileIndex(5399, manifest)).toBe(539);
    expect(tileIndex(5400, manifest)).toBe(539);
    expect(tileIndex(99_999, manifest)).toBe(539);
    expect(tileIndex(-5, manifest)).toBe(0);
  });

  it('honours another interval', () => {
    expect(tileIndex(7, { interval_ms: 2_500, thumbnail_count: 100 })).toBe(2);
  });
});

describe('tilePosition', () => {
  it('walks left to right, then down, then on to the next sheet', () => {
    expect(tilePosition(0, 10, 10)).toEqual({ sheet: 0, column: 0, row: 0 });
    expect(tilePosition(9, 10, 10)).toEqual({ sheet: 0, column: 9, row: 0 });
    expect(tilePosition(10, 10, 10)).toEqual({ sheet: 0, column: 0, row: 1 });
    expect(tilePosition(99, 10, 10)).toEqual({ sheet: 0, column: 9, row: 9 });
    expect(tilePosition(100, 10, 10)).toEqual({ sheet: 1, column: 0, row: 0 });
    expect(tilePosition(135, 10, 10)).toEqual({ sheet: 1, column: 5, row: 3 });
  });

  it('places the last thumbnail on a partly filled last sheet', () => {
    // 539 is thumbnail 39 of sheet 5: column 9, row 3 (the rows below are black).
    expect(tilePosition(539, 10, 10)).toEqual({ sheet: 5, column: 9, row: 3 });
  });

  it('works for a non-square grid', () => {
    expect(tilePosition(7, 5, 2)).toEqual({ sheet: 0, column: 2, row: 1 });
    expect(tilePosition(10, 5, 2)).toEqual({ sheet: 1, column: 0, row: 0 });
  });
});

describe('thumbnailBox', () => {
  it('draws a 300 px thumbnail at 256 px: the sheet scales by 256/300 and shifts to the tile', () => {
    // 1350 s is thumbnail 135: sheet 1, column 5, row 3.
    const box = thumbnailBox(1350, manifest);
    expect(box.sheet).toBe(1);
    expect(THUMB_DISPLAY_WIDTH).toBe(256);
    expect(box.width).toBe(256);
    expect(box.height).toBeCloseTo(107.52, 6);
    const [sizeX, sizeY] = box.backgroundSize.split(' ').map(parseFloat);
    expect(sizeX).toBeCloseTo(2560, 6);
    expect(sizeY).toBeCloseTo(1075.2, 6);
    const [x, y] = box.backgroundPosition.split(' ').map(parseFloat);
    expect(x).toBeCloseTo(-1280, 6);
    expect(y).toBeCloseTo(-322.56, 6);
  });

  it('makes the card as wide as the thumbnail, and the card without one slim', () => {
    expect(CARD_WIDTH_WITH_IMAGE).toBe(THUMB_DISPLAY_WIDTH);
    expect(CARD_WIDTH_PLAIN).toBeLessThan(CARD_WIDTH_WITH_IMAGE);
  });

  it('starts at the sheet origin for the first thumbnail', () => {
    const box = thumbnailBox(0, manifest);
    expect(box.sheet).toBe(0);
    expect(parseFloat(box.backgroundPosition)).toBeCloseTo(0, 6);
    expect(box.backgroundPosition).toMatch(/^-?0px -?0px$/);
  });

  it('uses the manifest aspect for the height', () => {
    const wide = thumbnailBox(0, { ...manifest, thumbnail_width: 320, thumbnail_height: 180 });
    // 16:9 at 256 px wide is 144 px tall.
    expect(wide.height).toBe(144);
    expect(wide.backgroundSize).toBe('2560px 1440px');
  });
});

describe('cardLeft', () => {
  const card = CARD_WIDTH_WITH_IMAGE;

  it('centres the card on the target', () => {
    expect(cardLeft(1000, card, 2000)).toBe(1000 - card / 2);
  });

  it('keeps the left end of the card on the scrubber', () => {
    expect(cardLeft(0, card, 2000)).toBe(0);
    expect(cardLeft(100, card, 2000)).toBe(0);
  });

  it('keeps the right end of the card on the scrubber', () => {
    expect(cardLeft(2000, card, 2000)).toBe(2000 - card);
    expect(cardLeft(1950, card, 2000)).toBe(2000 - card);
  });

  it('centres a card that is wider than the track', () => {
    expect(cardLeft(10, 400, 300)).toBe(-50);
  });
});

describe('chapters', () => {
  const chapters: Chapter[] = [
    { title: 'Opening', start: 0, end: 600 },
    { title: '', start: 600, end: 1800 },
    { title: 'Finale', start: 1800, end: 5400 },
  ];

  it('finds the chapter at a time; a start belongs to the chapter, an end to the next', () => {
    expect(chapterAt(chapters, 0)?.title).toBe('Opening');
    expect(chapterAt(chapters, 599.9)?.title).toBe('Opening');
    expect(chapterAt(chapters, 600)?.start).toBe(600);
    expect(chapterAt(chapters, 1800)?.title).toBe('Finale');
  });

  it('keeps the last chapter through its end and has none beyond the file', () => {
    expect(chapterAt(chapters, 5400)?.title).toBe('Finale');
    expect(chapterAt(chapters, 5401)).toBeNull();
    expect(chapterAt([], 10)).toBeNull();
  });

  it('gives no title for an untitled chapter, and trims the others', () => {
    expect(chapterTitleAt(chapters, 700)).toBeNull();
    expect(chapterTitleAt([{ title: '  ', start: 0, end: 10 }], 5)).toBeNull();
    expect(chapterTitleAt(chapters, 100)).toBe('Opening');
    expect(chapterTitleAt([{ title: ' A ', start: 0, end: 10 }], 5)).toBe('A');
  });

  it('puts a tick at every chapter start except 0', () => {
    expect(chapterTickFractions(chapters, 5400)).toEqual([600 / 5400, 1800 / 5400]);
    expect(chapterTickFractions(chapters, 0)).toEqual([]);
    expect(chapterTickFractions([{ title: '', start: 6000, end: 7000 }], 5400)).toEqual([]);
  });

  it('maps and orders the API chapters and drops unusable ones', () => {
    const api: components['schemas']['WatchChapter'][] = [
      { index: 1, title: 'B', source: 'file', start_seconds: 60, end_seconds: 120 },
      { index: 0, title: 'A', source: 'file', start_seconds: 0, end_seconds: 60 },
      { index: 2, title: 'Bad', source: 'file', start_seconds: 130, end_seconds: 130 },
    ];
    expect(toChapters(api)).toEqual([
      { title: 'A', start: 0, end: 60 },
      { title: 'B', start: 60, end: 120 },
    ]);
    expect(toChapters(undefined)).toEqual([]);
  });
});

describe('resolveSheetUrl', () => {
  it('resolves a relative URL against the server and leaves an absolute one untouched', () => {
    expect(resolveSheetUrl('/api/v2/artwork/t/0.jpg?exp=1&sig=a', 'https://silo.test')).toBe(
      'https://silo.test/api/v2/artwork/t/0.jpg?exp=1&sig=a',
    );
    const absolute = 'https://cdn.test/t/0.jpg?X-Sig=a%2Fb';
    expect(resolveSheetUrl(absolute, 'https://silo.test')).toBe(absolute);
  });

  it('refuses a scheme that is not http(s)', () => {
    expect(resolveSheetUrl('javascript:alert(1)', 'https://silo.test')).toBeNull();
    expect(resolveSheetUrl('data:image/png;base64,AA', 'https://silo.test')).toBeNull();
  });
});
