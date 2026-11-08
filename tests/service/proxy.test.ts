// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createProxy, MAX_BODY_BYTES } from '../../service/proxy.js';

interface FakeResponse {
  statusCode?: number;
  statusMessage?: string;
  headers?: Record<string, string | string[]>;
  chunks?: Buffer[];
  /** Never end the response (for timeouts). */
  hang?: boolean;
  requestError?: Error;
}

/** A fake http(s) transport; records what the proxy sent. */
function fakeTransport(response: FakeResponse) {
  const sent: { options: Record<string, unknown>; written: string[]; destroyed: boolean }[] = [];
  const request = (options: Record<string, unknown>, onResponse: (res: EventEmitter) => void) => {
    const record = { options, written: [] as string[], destroyed: false };
    sent.push(record);
    const req = Object.assign(new EventEmitter(), {
      write: (data: string) => record.written.push(data),
      destroy: () => {
        record.destroyed = true;
      },
      end: () => {
        if (response.requestError) {
          queueMicrotask(() => req.emit('error', response.requestError));
          return;
        }
        if (response.hang) return;
        const res = Object.assign(new EventEmitter(), {
          statusCode: response.statusCode ?? 200,
          statusMessage: response.statusMessage ?? 'OK',
          headers: response.headers ?? {},
        });
        queueMicrotask(() => {
          onResponse(res);
          for (const chunk of response.chunks ?? []) res.emit('data', chunk);
          res.emit('end');
        });
      },
    });
    return req;
  };
  return { transport: { http: { request }, https: { request } }, sent };
}

const API = 'https://silo.example.test/api/v2/items?limit=5';

describe('proxy fetch validation', () => {
  it.each([
    ['ftp://silo.example.test/api/v2/x', /http and https/],
    ['file:///api/v2/x', /http and https/],
    ['not a url', /not valid/],
    ['https://silo.example.test/other/api/v2/x', /\/api\/v2\//],
    ['https://silo.example.test/api/v1/x', /\/api\/v2\//],
    ['https://silo.example.test/api/v2', /\/api\/v2\//],
  ])('rejects %s', async (url, message) => {
    const { transport, sent } = fakeTransport({});
    const result = await createProxy(transport).fetch({ url });
    expect(result).toMatchObject({ returnValue: false });
    expect((result as { errorText: string }).errorText).toMatch(message);
    expect(sent).toHaveLength(0);
  });

  it('rejects a missing url and an unsupported method', async () => {
    const { transport, sent } = fakeTransport({});
    const proxy = createProxy(transport);
    expect(await proxy.fetch({})).toMatchObject({ returnValue: false });
    expect(await proxy.fetch({ url: API, method: 'TRACE' })).toMatchObject({
      returnValue: false,
      errorText: expect.stringContaining('TRACE'),
    });
    expect(sent).toHaveLength(0);
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'post'])(
    'allows %s',
    async (method) => {
      const { transport, sent } = fakeTransport({});
      const result = await createProxy(transport).fetch({ url: API, method });
      expect(result).toMatchObject({ returnValue: true });
      expect(sent[0]?.options.method).toBe(method.toUpperCase());
    },
  );
});

describe('proxy fetch', () => {
  it('forwards method, headers, body and the URL parts', async () => {
    const { transport, sent } = fakeTransport({});
    await createProxy(transport).fetch({
      url: 'http://silo.example.test:8080/api/v2/items?limit=5',
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(sent[0]?.options).toMatchObject({
      hostname: 'silo.example.test',
      port: '8080',
      path: '/api/v2/items?limit=5',
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    });
    expect(sent[0]?.written).toEqual(['{"a":1}']);
  });

  it('uses the https transport for https URLs and the http one for http URLs', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = fakeTransport({}).transport.https.request;
    const proxy = createProxy({ http: { request: httpRequest }, https: { request: httpsRequest } });
    expect(await proxy.fetch({ url: API })).toMatchObject({ returnValue: true });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('returns status, only the whitelisted headers and the utf8 body', async () => {
    const { transport } = fakeTransport({
      statusCode: 404,
      statusMessage: 'Not Found',
      headers: {
        'content-type': 'application/json',
        etag: '"abc"',
        'set-cookie': 'secret=1',
        'x-other': 'no',
        'retry-after': '3',
      },
      chunks: [Buffer.from('{"title":"Gr'), Buffer.from('ün"}')],
    });
    expect(await createProxy(transport).fetch({ url: API })).toEqual({
      returnValue: true,
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json', etag: '"abc"', 'retry-after': '3' },
      body: '{"title":"Grün"}',
    });
  });

  it('aborts and errors when the body exceeds 10 MB', async () => {
    const { transport, sent } = fakeTransport({
      chunks: [Buffer.alloc(MAX_BODY_BYTES), Buffer.alloc(1)],
    });
    const result = await createProxy(transport).fetch({ url: API });
    expect(result).toMatchObject({ returnValue: false });
    expect((result as { errorText: string }).errorText).toMatch(/exceeds/);
    expect(sent[0]?.destroyed).toBe(true);
  });

  it('accepts a body of exactly 10 MB', async () => {
    const { transport } = fakeTransport({ chunks: [Buffer.alloc(MAX_BODY_BYTES, 'a')] });
    expect(await createProxy(transport).fetch({ url: API })).toMatchObject({ returnValue: true });
  });

  it('times out and destroys the request', async () => {
    const { transport, sent } = fakeTransport({ hang: true });
    const result = await createProxy(transport).fetch({ url: API, timeoutMs: 20 });
    expect(result).toMatchObject({ returnValue: false });
    expect((result as { errorText: string }).errorText).toMatch(/timed out after 20 ms/);
    expect(sent[0]?.destroyed).toBe(true);
  });

  it('uses a default timeout of 15000 ms', async () => {
    vi.useFakeTimers();
    try {
      const { transport, sent } = fakeTransport({ hang: true });
      let result: unknown;
      void createProxy(transport)
        .fetch({ url: API })
        .then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(14999);
      expect(result).toBeUndefined();
      expect(sent[0]?.destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual({
        returnValue: false,
        errorText: 'request timed out after 15000 ms',
      });
      expect(sent[0]?.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps transport errors to returnValue false', async () => {
    const { transport } = fakeTransport({ requestError: new Error('connect ECONNREFUSED') });
    expect(await createProxy(transport).fetch({ url: API })).toEqual({
      returnValue: false,
      errorText: 'connect ECONNREFUSED',
    });
  });

  it('never logs requests', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { transport } = fakeTransport({});
    await createProxy(transport).fetch({
      url: API,
      headers: { Authorization: 'Bearer test-token' },
      body: 'secret-body',
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('proxy ping', () => {
  it('returns the node version', () => {
    expect(createProxy(fakeTransport({}).transport).ping()).toEqual({
      returnValue: true,
      node: process.version,
    });
  });
});
