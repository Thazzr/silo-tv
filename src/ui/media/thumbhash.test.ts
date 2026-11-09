import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHash, stubCanvas } from '../../test/thumbhashFixtures';
import { BoundedCache, thumbhashColor, thumbhashPreview, thumbhashToBitmap } from './thumbhash';

/** A ThumbHash whose average colour has luminance `l` (0-63) and chroma `p`, `q` (0-63). */
function hash(l: number, p: number, q: number): string {
  const header = l | (p << 6) | (q << 12);
  const bytes = [header & 255, (header >> 8) & 255, (header >> 16) & 255, 0, 0];
  return btoa(String.fromCharCode(...bytes));
}

function channels(color: string | null): number[] {
  return (color ?? '').match(/\d+/g)?.map(Number) ?? [];
}

describe('thumbhashColor', () => {
  it('reads the average colour: dark hashes are dark and light hashes are light', () => {
    const dark = channels(thumbhashColor(hash(2, 32, 32)));
    const light = channels(thumbhashColor(hash(60, 32, 32)));
    expect(dark).toHaveLength(3);
    expect(Math.max(...dark)).toBeLessThan(30);
    expect(Math.min(...light)).toBeGreaterThan(200);
  });

  it('follows the chroma: a warm hash has more red than blue', () => {
    const [r, , b] = channels(thumbhashColor(hash(32, 32, 55)));
    expect(r!).toBeGreaterThan(b!);
  });

  it('answers null for a missing, malformed or too short hash', () => {
    expect(thumbhashColor(undefined)).toBeNull();
    expect(thumbhashColor('')).toBeNull();
    expect(thumbhashColor('***not base64***')).toBeNull();
    expect(thumbhashColor(btoa('ab'))).toBeNull();
  });
});

describe('thumbhashToBitmap', () => {
  const pixel = (bitmap: NonNullable<ReturnType<typeof thumbhashToBitmap>>, x: number, y: number) =>
    Array.from(bitmap.rgba.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));

  it('sizes the bitmap from the hash: the longer side is 32 px', () => {
    const portrait = thumbhashToBitmap(makeHash({ count: 3 }))!;
    expect([portrait.width, portrait.height]).toEqual([14, 32]);
    const landscape = thumbhashToBitmap(makeHash({ count: 3, landscape: true }))!;
    expect([landscape.width, landscape.height]).toEqual([32, 14]);
    const square = thumbhashToBitmap(makeHash({ count: 7 }))!;
    expect([square.width, square.height]).toEqual([32, 32]);
    expect(portrait.rgba).toHaveLength(14 * 32 * 4);
  });

  it('fills the bitmap with the average colour when there are no coefficients', () => {
    const hash = makeHash({ l: 63, p: 32, q: 32 });
    const bitmap = thumbhashToBitmap(hash)!;
    const [r, g, b] = channels(thumbhashColor(hash));
    for (const [x, y] of [
      [0, 0],
      [13, 31],
      [7, 16],
    ] as const) {
      const [pr, pg, pb, pa] = pixel(bitmap, x, y);
      expect(Math.abs(pr! - r!)).toBeLessThanOrEqual(1);
      expect(Math.abs(pg! - g!)).toBeLessThanOrEqual(1);
      expect(Math.abs(pb! - b!)).toBeLessThanOrEqual(1);
      expect(pa).toBe(255);
    }
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(240);
  });

  it('is dark for a dark hash', () => {
    const [r, g, b] = pixel(thumbhashToBitmap(makeHash({ l: 4 }))!, 3, 3);
    expect(Math.max(r!, g!, b!)).toBeLessThan(40);
  });

  it('draws the coefficients: a strong first one makes the left bright and the right dark', () => {
    // The first luminance coefficient is the horizontal gradient; nibble 15 is its maximum.
    const bitmap = thumbhashToBitmap(
      makeHash({ l: 32, lScale: 31, count: 3, landscape: true, ac: [15] }),
    )!;
    const y = Math.floor(bitmap.height / 2);
    const left = pixel(bitmap, 1, y)[0]!;
    const right = pixel(bitmap, bitmap.width - 2, y)[0]!;
    expect(left).toBeGreaterThan(right + 100);
  });

  it('is deterministic', () => {
    const hash = makeHash({ l: 30, lScale: 20, pScale: 30, qScale: 30, ac: [3, 12, 9, 1, 15, 4] });
    expect(Array.from(thumbhashToBitmap(hash)!.rgba)).toEqual(
      Array.from(thumbhashToBitmap(hash)!.rgba),
    );
  });

  it('answers null for a missing, malformed, too short or truncated hash', () => {
    expect(thumbhashToBitmap(undefined)).toBeNull();
    expect(thumbhashToBitmap('')).toBeNull();
    expect(thumbhashToBitmap('***not base64***')).toBeNull();
    expect(thumbhashToBitmap(btoa('abcd'))).toBeNull();
    // Five bytes announce 3 x 7 coefficients, which need more bytes than that.
    expect(thumbhashToBitmap(btoa(atob(makeHash({ count: 3 })).slice(0, 5)))).toBeNull();
  });
});

describe('BoundedCache', () => {
  it('forgets the oldest entry once it holds more than its bound', () => {
    const cache = new BoundedCache<number>(3);
    for (const [key, value] of [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ] as const) {
      cache.set(key, value);
    }
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('d')).toBe(4);
  });

  it('keeps a key that is set again as the newest', () => {
    const cache = new BoundedCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    expect(cache.get('a')).toBe(3);
    expect(cache.get('b')).toBeUndefined();
  });
});

describe('thumbhashPreview', () => {
  beforeEach(() => {
    stubCanvas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the decoded hash on a canvas of the bitmap size and returns its data URL', () => {
    expect(thumbhashPreview(makeHash({ count: 3 }))).toBe('data:image/png;base64,14x32');
  });

  it('is null without a hash, for an unreadable hash and without a canvas', () => {
    expect(thumbhashPreview(undefined)).toBeNull();
    expect(thumbhashPreview('***')).toBeNull();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null);
    expect(thumbhashPreview(makeHash({ l: 11 }))).toBeNull();
  });

  it('encodes a hash once and keeps at most 200 previews', () => {
    const encode = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    const hashes = Array.from({ length: 205 }, (_, i) =>
      makeHash({ l: i % 64, p: Math.floor(i / 64) }),
    );
    for (const hash of hashes) thumbhashPreview(hash);
    expect(encode).toHaveBeenCalledTimes(205);
    thumbhashPreview(hashes[204]!);
    expect(encode).toHaveBeenCalledTimes(205);
    // The oldest one was dropped to stay within the bound, so it is drawn again.
    thumbhashPreview(hashes[0]!);
    expect(encode).toHaveBeenCalledTimes(206);
  });
});
