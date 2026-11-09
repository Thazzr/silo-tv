import { describe, expect, it } from 'vitest';
import { contrastOnBlack, hostOf, initialOf, resolveAssetUrl, usableAccent } from './branding';

describe('contrastOnBlack', () => {
  it('is 21:1 for white and 1:1 for black', () => {
    expect(contrastOnBlack('#ffffff')).toBeCloseTo(21, 5);
    expect(contrastOnBlack('#000')).toBeCloseTo(1, 5);
  });

  it('reads short and upper case hex and rejects anything else', () => {
    expect(contrastOnBlack('#FFF')).toBeCloseTo(21, 5);
    expect(contrastOnBlack('rgb(255,255,255)')).toBeNull();
    expect(contrastOnBlack('#ffff')).toBeNull();
    expect(contrastOnBlack('ffffff')).toBeNull();
    expect(contrastOnBlack('url(javascript:1)')).toBeNull();
  });
});

describe('usableAccent', () => {
  it('rejects a dark accent that stays below 4.5:1 on black', () => {
    expect(usableAccent('#1a2b6d')).toBeNull();
    expect(usableAccent('#707070')).toBeNull();
  });

  it('accepts a light accent', () => {
    expect(usableAccent('#e5a00d')).toBe('#e5a00d');
    expect(usableAccent(' #ffffff ')).toBe('#ffffff');
    // Just above the threshold.
    expect(usableAccent('#767676')).toBe('#767676');
  });

  it('ignores a missing or malformed value', () => {
    expect(usableAccent(undefined)).toBeNull();
    expect(usableAccent('')).toBeNull();
    expect(usableAccent('orange')).toBeNull();
  });
});

describe('resolveAssetUrl', () => {
  const origin = 'https://silo.example.test';

  it('resolves a reference against the server origin and keeps its query', () => {
    expect(resolveAssetUrl(origin, '/api/v2/branding/assets/mark?v=abc')).toBe(
      `${origin}/api/v2/branding/assets/mark?v=abc`,
    );
    expect(resolveAssetUrl(origin, 'assets/mark.png')).toBe(`${origin}/assets/mark.png`);
  });

  it('keeps an absolute http(s) URL as it is', () => {
    expect(resolveAssetUrl(origin, 'https://cdn.example.test/m.png')).toBe(
      'https://cdn.example.test/m.png',
    );
  });

  it('refuses other schemes and empty references', () => {
    expect(resolveAssetUrl(origin, 'javascript:alert(1)')).toBeNull();
    expect(resolveAssetUrl(origin, 'data:image/png;base64,AAAA')).toBeNull();
    expect(resolveAssetUrl(origin, undefined)).toBeNull();
    expect(resolveAssetUrl(origin, '   ')).toBeNull();
  });
});

describe('names', () => {
  it('uses the host of an origin and the first letter of a name', () => {
    expect(hostOf('https://silo.example.test:8443')).toBe('silo.example.test:8443');
    expect(initialOf('  movie barn')).toBe('M');
    expect(initialOf('')).toBe('?');
  });
});
