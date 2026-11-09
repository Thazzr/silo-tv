import { describe, expect, it } from 'vitest';
import { thumbhashColor } from './thumbhash';

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
