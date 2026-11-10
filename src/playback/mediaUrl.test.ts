import { describe, expect, it } from 'vitest';
import { authHeadersFor, mediaUrlWithToken } from './mediaUrl';

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

describe('authHeadersFor', () => {
  const session = { accessToken: 'abc', profileId: 'p1', profileToken: 'pt' };

  it('gives the bearer token and the profile headers for a URL on the server origin', () => {
    expect(authHeadersFor(`${SERVER}/api/v2/stream/s1/seg1.ts?st=x`, SERVER, session)).toEqual({
      Authorization: 'Bearer abc',
      'X-Profile-Id': 'p1',
      'X-Profile-Token': 'pt',
    });
  });

  it('leaves out the profile headers that are not set', () => {
    expect(authHeadersFor(`${SERVER}/a`, SERVER, { accessToken: 'abc' })).toEqual({
      Authorization: 'Bearer abc',
    });
  });

  it('treats a relative URL as the server origin', () => {
    expect(authHeadersFor('/api/v2/stream/s1/index.m3u8', SERVER, session)).toMatchObject({
      Authorization: 'Bearer abc',
    });
  });

  it('gives nothing for another origin, scheme or port', () => {
    expect(authHeadersFor('https://proxy.example.test/stream/s1', SERVER, session)).toEqual({});
    expect(authHeadersFor('http://silo.example.test/stream/s1', SERVER, session)).toEqual({});
    expect(authHeadersFor('https://silo.example.test:8443/s1', SERVER, session)).toEqual({});
  });

  it('gives nothing without a session or without an access token', () => {
    expect(authHeadersFor(`${SERVER}/a`, SERVER, null)).toEqual({});
    expect(authHeadersFor(`${SERVER}/a`, SERVER, undefined)).toEqual({});
    expect(authHeadersFor(`${SERVER}/a`, SERVER, { ...session, accessToken: '' })).toEqual({});
  });

  it('gives nothing when the server origin is not a URL', () => {
    expect(authHeadersFor(`${SERVER}/a`, 'not a url', session)).toEqual({});
  });
});
