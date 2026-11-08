import { describe, expect, it } from 'vitest';
import { mediaUrlWithToken } from './mediaUrl';

const SERVER = 'https://silo.example.test';

describe('mediaUrlWithToken', () => {
  it('appends the token to a URL on the server origin', () => {
    expect(mediaUrlWithToken(`${SERVER}/api/v2/stream/s1`, SERVER, 'abc')).toBe(
      `${SERVER}/api/v2/stream/s1?token=abc`,
    );
  });

  it('resolves a relative URL against the server and appends the token', () => {
    expect(mediaUrlWithToken('/api/v2/stream/s1?st=signed', SERVER, 'abc')).toBe(
      `${SERVER}/api/v2/stream/s1?st=signed&token=abc`,
    );
  });

  it('keeps the existing query exactly, including its own escapes', () => {
    expect(mediaUrlWithToken(`${SERVER}/m.m3u8?st=a%2Bb%3D&seek=12`, SERVER, 'abc')).toBe(
      `${SERVER}/m.m3u8?st=a%2Bb%3D&seek=12&token=abc`,
    );
  });

  it('URL-encodes the token value', () => {
    expect(mediaUrlWithToken(`${SERVER}/s`, SERVER, 'a b&c=d/e+f')).toBe(
      `${SERVER}/s?token=a%20b%26c%3Dd%2Fe%2Bf`,
    );
  });

  it('keeps a fragment behind the token', () => {
    expect(mediaUrlWithToken(`${SERVER}/s?st=1#t=5`, SERVER, 'abc')).toBe(
      `${SERVER}/s?st=1&token=abc#t=5`,
    );
  });

  it('never adds the token for another origin and returns the URL unchanged', () => {
    const proxy = 'https://proxy.example.test/stream/v3/s1?st=node-signed';
    expect(mediaUrlWithToken(proxy, SERVER, 'abc')).toBe(proxy);
    // Same host with another scheme or port is another origin too.
    const insecure = 'http://silo.example.test/stream/s1';
    expect(mediaUrlWithToken(insecure, SERVER, 'abc')).toBe(insecure);
    const port = 'https://silo.example.test:8443/stream/s1';
    expect(mediaUrlWithToken(port, SERVER, 'abc')).toBe(port);
  });

  it('adds no token parameter without a token', () => {
    expect(mediaUrlWithToken('/api/v2/stream/s1?st=x', SERVER, undefined)).toBe(
      `${SERVER}/api/v2/stream/s1?st=x`,
    );
  });
});
