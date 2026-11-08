import { describe, expect, it } from 'vitest';
import { BASE_URL, systemInfo } from '../test/apiFixtures';
import { checkServer, normalizeServerUrl } from './server';
import type { Transport } from './transport';

describe('normalizeServerUrl', () => {
  it.each([
    ['silo.example.test', 'https://silo.example.test'],
    ['  Silo.Example.Test  ', 'https://silo.example.test'],
    ['http://192.168.1.5:8080', 'http://192.168.1.5:8080'],
    ['https://silo.example.test/', 'https://silo.example.test'],
    ['https://silo.example.test/some/path?q=1#frag', 'https://silo.example.test'],
    ['silo.example.test:8443/app', 'https://silo.example.test:8443'],
    ['192.168.1.5:8096', 'https://192.168.1.5:8096'],
    ['https://user:pw@silo.example.test', 'https://silo.example.test'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'javascript://host/%0aalert(1)',
    'JavaScript:alert(1)',
    'ftp://silo.example.test',
    'file:///etc/passwd',
    'https://',
  ])('rejects %j', (input) => {
    expect(normalizeServerUrl(input)).toBeNull();
  });
});

const device = { id: 'a'.repeat(32), name: 'LG webOS TV' };

function json(body: unknown, status = 200): Transport {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('checkServer', () => {
  it('accepts a server with api_major 2 and returns its info', async () => {
    const result = await checkServer(BASE_URL, json(systemInfo), device);
    expect(result).toEqual({ ok: true, info: systemInfo });
  });

  it('asks GET /api/v2/system/info on the given origin', async () => {
    let url = '';
    await checkServer(
      BASE_URL,
      async (request) => {
        url = `${request.method} ${request.url}`;
        return new Response(JSON.stringify(systemInfo));
      },
      device,
    );
    expect(url).toBe(`GET ${BASE_URL}/api/v2/system/info`);
  });

  it('reports not_silo for an HTML answer, a missing api_major and a 404', async () => {
    const html: Transport = async () =>
      new Response('<html>hello</html>', { headers: { 'Content-Type': 'text/html' } });
    expect(await checkServer(BASE_URL, html, device)).toEqual({ ok: false, reason: 'not_silo' });
    expect(await checkServer(BASE_URL, json({ hello: 'world' }), device)).toEqual({
      ok: false,
      reason: 'not_silo',
    });
    expect(await checkServer(BASE_URL, json({}, 404), device)).toEqual({
      ok: false,
      reason: 'not_silo',
    });
  });

  it('reports unsupported_api for another major version', async () => {
    expect(await checkServer(BASE_URL, json({ ...systemInfo, api_major: 1 }), device)).toEqual({
      ok: false,
      reason: 'unsupported_api',
    });
  });

  it('reports unreachable for a network error and a gateway error', async () => {
    const down: Transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await checkServer(BASE_URL, down, device)).toEqual({ ok: false, reason: 'unreachable' });
    expect(await checkServer(BASE_URL, json({}, 502), device)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });
});
