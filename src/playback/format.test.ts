import { describe, expect, it } from 'vitest';
import { LOWER_UUID } from '../test/playbackFixtures';
import { formatClock, redact } from './format';
import { uuidV4 } from './uuid';

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [75, '1:15'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [5025.9, '1:23:45'],
    [-4, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
  ])('formats %s as %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
});

describe('redact', () => {
  it('removes secrets and any URL', () => {
    const text = 'open failed for https://silo.example.test/s?token=abc&st=1 (secret-1)';
    const result = redact(text, ['secret-1', undefined, '']);
    expect(result).not.toContain('secret-1');
    expect(result).not.toContain('silo.example.test');
    expect(result).not.toContain('token=abc');
    expect(result).toContain('open failed for');
  });

  it('also removes the URL-encoded form of a secret', () => {
    expect(redact('x a%20b%2Fc y a b/c', ['a b/c'])).toBe('x [hidden] y [hidden]');
  });
});

describe('uuidV4', () => {
  it('is a lowercase canonical version 4 UUID and differs between calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => uuidV4()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(LOWER_UUID);
  });
});
