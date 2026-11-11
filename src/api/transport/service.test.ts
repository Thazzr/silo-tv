import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTests } from '../../platform';
import { serviceTransport } from './service';

const URL_ = 'https://silo.example.test/api/v2/x';

interface ProxyResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

function usePlatform(proxyFetch: ((r: unknown) => Promise<ProxyResult>) | undefined) {
  setPlatformForTests({ proxyFetch } as never);
}

const ok = (over: Partial<ProxyResult> = {}): ProxyResult => ({
  status: 200,
  statusText: 'OK',
  headers: {},
  body: '',
  ...over,
});

afterEach(() => {
  setPlatformForTests(null);
});

describe('serviceTransport request mapping', () => {
  it.each(['GET', 'HEAD'])('does not read a body for %s and sends none', async (method) => {
    const proxy = vi.fn(async () => ok());
    usePlatform(proxy);
    const text = vi.fn(async () => 'must not be read');
    // A Request cannot carry a body for these methods, so a stand-in shows whether it was read.
    const request = {
      method,
      url: URL_,
      headers: new Headers({ 'X-A': '1' }),
      signal: new AbortController().signal,
      text,
    } as unknown as Request;
    await serviceTransport(request);
    expect(text).not.toHaveBeenCalled();
    expect(proxy).toHaveBeenCalledWith({ url: URL_, method, headers: { 'x-a': '1' } });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('reads and sends the body for %s', async (method) => {
    const proxy = vi.fn(async () => ok());
    usePlatform(proxy);
    await serviceTransport(new Request(URL_, { method, body: '{"q":1}' }));
    expect(proxy).toHaveBeenCalledWith({
      url: URL_,
      method,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: '{"q":1}',
    });
  });

  it('sends no body key for an empty body', async () => {
    const proxy = vi.fn(async () => ok());
    usePlatform(proxy);
    await serviceTransport(new Request(URL_, { method: 'POST' }));
    expect((proxy.mock.calls as unknown[][])[0]?.[0]).toEqual({
      url: URL_,
      method: 'POST',
      headers: {},
    });
    expect(proxy).toHaveBeenCalledTimes(1);
  });
});

describe('serviceTransport failures', () => {
  it('fails like a network error, with a message, when the platform has no proxy', async () => {
    usePlatform(undefined);
    const error = await serviceTransport(new Request(URL_)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(
      'Network request failed: no proxy service on this platform',
    );
  });

  it('wraps a proxy error, keeping the original as the cause', async () => {
    const cause = new Error('connect refused');
    usePlatform(async () => {
      throw cause;
    });
    const error = await serviceTransport(new Request(URL_)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('Network request failed: connect refused');
    expect((error as Error).cause).toBe(cause);
  });

  it('wraps a non-Error rejection by its string form', async () => {
    usePlatform(async () => {
      throw 'offline';
    });
    const error = await serviceTransport(new Request(URL_)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('Network request failed: offline');
    expect((error as Error).cause).toBe('offline');
  });
});

describe('serviceTransport response mapping', () => {
  it('maps status, status text, headers and body', async () => {
    usePlatform(async () =>
      ok({ status: 201, statusText: 'Created', headers: { 'x-extra': '1' }, body: '{"a":1}' }),
    );
    const response = await serviceTransport(new Request(URL_));
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('x-extra')).toBe('1');
    expect(await response.text()).toBe('{"a":1}');
  });

  it.each([204, 205, 304])('builds a %i without a body', async (status) => {
    usePlatform(async () => ok({ status, statusText: 'x', body: '' }));
    const response = await serviceTransport(new Request(URL_));
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it('keeps the body of a status that may carry one', async () => {
    usePlatform(async () => ok({ status: 404, body: 'nope' }));
    const response = await serviceTransport(new Request(URL_));
    expect(await response.text()).toBe('nope');
  });
});
