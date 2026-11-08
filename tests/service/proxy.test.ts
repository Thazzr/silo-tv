// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import pkg from '../../service/package.json';
import {
  appIdOf,
  createGuardedLookup,
  createHandlers,
  createProxy,
  isAllowedCaller,
  isBlockedHost,
  MAX_BODY_BYTES,
} from '../../service/proxy.js';

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

const APP_ID = 'io.github.thazzr.silolg';

describe('appIdOf', () => {
  it('strips the .service suffix, and matches the app ID of the app side', () => {
    expect(appIdOf('io.github.thazzr.silolg.service')).toBe(APP_ID);
    // Read as text: importing the app module would pull browser-only code into the node typecheck.
    const source = readFileSync('src/platform/serviceFetch.ts', 'utf8');
    expect(appIdOf(pkg.name)).toBe(/APP_ID = '([^']+)'/.exec(source)?.[1]);
  });
});

describe('isAllowedCaller', () => {
  it.each([APP_ID, `${APP_ID} 1234`, `${APP_ID} 7`])('allows %j', (sender) => {
    expect(isAllowedCaller(sender, APP_ID)).toBe(true);
  });

  it.each([
    'com.other.app',
    `${APP_ID}.evil`,
    `${APP_ID}x`,
    `${APP_ID}-1`,
    `${APP_ID} `,
    `${APP_ID} 12a`,
    `${APP_ID} 12 34`,
    ` ${APP_ID}`,
    '',
    undefined,
    null,
    42,
  ])('refuses %j', (sender) => {
    expect(isAllowedCaller(sender, APP_ID)).toBe(false);
  });
});

describe('isBlockedHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'foo.localhost',
    'localhost.',
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '0.1.2.3',
    '169.254.169.254',
    '::1',
    '[::1]',
    '::',
    '[::]',
    'fe80::1',
    '[fe80::abcd]',
    'febf::1',
    '::ffff:127.0.0.1',
    '[::ffff:7f00:1]',
    '::ffff:0.0.0.0',
    '::ffff:169.254.1.1',
    '[::ffff:a9fe:101]',
  ])('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each([
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '8.8.8.8',
    '169.255.0.1',
    '128.0.0.1',
    'silo.example.test',
    'notlocalhost',
    'localhost.example.test',
    'fc00::1',
    'fd12:3456::1',
    '2001:db8::1',
    'fec0::1',
    '::ffff:192.168.1.20',
    '[::ffff:c0a8:114]',
  ])('allows %s', (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  it.each([
    'http://localhost/api/v2/x',
    'http://foo.localhost/api/v2/x',
    'http://127.0.0.1:8080/api/v2/x',
    'http://0.0.0.0/api/v2/x',
    'http://169.254.169.254/api/v2/x',
    'http://[::1]/api/v2/x',
    'http://[::ffff:127.0.0.1]/api/v2/x',
    'http://[fe80::1]/api/v2/x',
    'http://2130706433/api/v2/x',
  ])('fetch refuses %s without sending anything', async (url) => {
    const { transport, sent } = fakeTransport({});
    const result = await createProxy(transport).fetch({ url });
    expect(result).toMatchObject({ returnValue: false });
    expect((result as { errorText: string }).errorText).toMatch(/host is not allowed|not allowed/);
    expect(sent).toHaveLength(0);
  });

  it.each([
    'http://10.0.0.5/api/v2/x',
    'http://192.168.1.20:8096/api/v2/x',
    'https://silo.example.test/api/v2/x',
  ])('fetch allows %s', async (url) => {
    const { transport, sent } = fakeTransport({});
    expect(await createProxy(transport).fetch({ url })).toMatchObject({ returnValue: true });
    expect(sent).toHaveLength(1);
  });
});

describe('DNS guard', () => {
  type LookupCb = (err: Error | null, address?: unknown, family?: number) => void;
  const lookupTo = (address: string) => (_host: string, _opts: unknown, cb: LookupCb) =>
    cb(null, address, 4);

  function resolveWith(address: string, opts: Record<string, unknown> = {}) {
    const guarded = createGuardedLookup(lookupTo(address));
    return new Promise<{ err: Error | null; address?: unknown }>((resolve) =>
      guarded('silo.example.test', opts, (err: Error | null, addr: unknown) =>
        resolve({ err, address: addr }),
      ),
    );
  }

  it('refuses a name that resolves to a blocked address', async () => {
    for (const address of ['127.0.0.1', '169.254.1.1', '::1', '::ffff:127.0.0.1']) {
      const { err } = await resolveWith(address);
      expect(err?.message).toMatch(/blocked/);
    }
  });

  it('lets a name that resolves to a private LAN address proceed', async () => {
    expect(await resolveWith('192.168.1.20')).toEqual({ err: null, address: '192.168.1.20' });
  });

  it('checks every entry when the lookup returns all addresses', async () => {
    const all = (_h: string, _o: unknown, cb: LookupCb) =>
      cb(null, [
        { address: '192.168.1.20', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);
    const guarded = createGuardedLookup(all);
    const err = await new Promise<Error | null>((resolve) =>
      guarded('h.example.test', { all: true }, (e: Error | null) => resolve(e)),
    );
    expect(err?.message).toMatch(/blocked/);
  });

  it('passes lookup errors through and supports the two-argument form', async () => {
    const failing = (_h: string, _o: unknown, cb: LookupCb) => cb(new Error('ENOTFOUND'));
    const err = await new Promise<Error | null>((resolve) =>
      createGuardedLookup(failing)('h.example.test', (e: Error | null) => resolve(e)),
    );
    expect(err?.message).toBe('ENOTFOUND');
  });

  it('is installed as the lookup option of the outgoing request', async () => {
    const { transport, sent } = fakeTransport({});
    await createProxy(transport, { lookup: lookupTo('127.0.0.1') }).fetch({ url: API });
    const lookup = sent[0]?.options.lookup as ReturnType<typeof createGuardedLookup>;
    const err = await new Promise<Error | null>((resolve) =>
      lookup('silo.example.test', {}, (e: Error | null) => resolve(e)),
    );
    expect(err?.message).toMatch(/blocked/);
  });

  it('fails a real request whose name resolves to the TV itself, before connecting', async () => {
    let connections = 0;
    const server = createServer((_req, res) => res.end('x'));
    server.on('connection', () => connections++);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const result = await createProxy(undefined, { lookup: lookupTo('127.0.0.1') }).fetch({
        url: `http://silo.example.test:${port}/api/v2/system/info`,
      });
      expect(result).toMatchObject({ returnValue: false });
      expect((result as { errorText: string }).errorText).toMatch(/blocked/);
      expect(connections).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe('path smuggling', () => {
  it.each([
    'https://silo.example.test/api/v2/%2f..%2fadmin',
    'https://silo.example.test/api/v2/%2F..%2Fadmin',
    'https://silo.example.test/api/v2/..%5Cx',
    'https://silo.example.test/api/v2/..%5cx',
    'https://silo.example.test/api/v2\\x',
    'https://silo.example.test/api/v2/a\\..\\x',
  ])('refuses %s', async (url) => {
    const { transport, sent } = fakeTransport({});
    const result = await createProxy(transport).fetch({ url });
    expect(result).toMatchObject({ returnValue: false });
    expect((result as { errorText: string }).errorText).toMatch(/backslashes or encoded slashes/);
    expect(sent).toHaveLength(0);
  });

  it('passes a normal path and keeps an encoded slash in the query', async () => {
    const { transport, sent } = fakeTransport({});
    const proxy = createProxy(transport);
    expect(
      await proxy.fetch({ url: 'https://silo.example.test/api/v2/system/info?x=1' }),
    ).toMatchObject({ returnValue: true });
    expect(
      await proxy.fetch({ url: 'https://silo.example.test/api/v2/items?next=a%2Fb' }),
    ).toMatchObject({ returnValue: true });
    expect(sent[0]?.options.path).toBe('/api/v2/system/info?x=1');
    expect(sent[1]?.options.path).toBe('/api/v2/items?next=a%2Fb');
  });

  it('still applies the /api/v2/ prefix to the normalised path', async () => {
    const { transport, sent } = fakeTransport({});
    const result = await createProxy(transport).fetch({
      url: 'https://silo.example.test/api/v2/../admin',
    });
    expect(result).toMatchObject({ returnValue: false });
    expect(sent).toHaveLength(0);
  });
});

describe('request headers', () => {
  const STRIPPED = [
    'Host',
    'Connection',
    'Keep-Alive',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
    'Content-Length',
  ];

  it.each(STRIPPED)('strips %s in any case', async (name) => {
    for (const variant of [name, name.toLowerCase(), name.toUpperCase()]) {
      const { transport, sent } = fakeTransport({});
      await createProxy(transport).fetch({ url: API, headers: { [variant]: 'x' } });
      expect(sent[0]?.options.headers).toEqual({});
    }
  });

  it('keeps Authorization and X-Silo-* headers and sets Content-Length from the body', async () => {
    const { transport, sent } = fakeTransport({});
    await createProxy(transport).fetch({
      url: API,
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'X-Silo-Device-Id': 'dev-1',
        'content-length': '999',
        Host: 'evil.example.test',
      },
      body: 'äö',
    });
    expect(sent[0]?.options.headers).toEqual({
      Authorization: 'Bearer test-token',
      'X-Silo-Device-Id': 'dev-1',
      'Content-Length': '4',
    });
  });

  it('sets no Content-Length without a body', async () => {
    const { transport, sent } = fakeTransport({});
    await createProxy(transport).fetch({ url: API, headers: { 'Content-Length': '5' } });
    expect(sent[0]?.options.headers).toEqual({});
  });
});

describe('redirects', () => {
  it('returns a 3xx as-is with its location and does not follow it', async () => {
    const { transport, sent } = fakeTransport({
      statusCode: 302,
      statusMessage: 'Found',
      headers: { location: 'http://127.0.0.1/api/v2/secret' },
    });
    const result = await createProxy(transport).fetch({ url: API });
    expect(result).toMatchObject({
      returnValue: true,
      status: 302,
      headers: { location: 'http://127.0.0.1/api/v2/secret' },
    });
    expect(sent).toHaveLength(1);
  });
});

describe('handlers', () => {
  function setup() {
    const proxy = { fetch: vi.fn(() => Promise.resolve({ returnValue: true })) };
    return { proxy, handlers: createHandlers({ appId: APP_ID, proxy }) };
  }

  it('forwards fetch from our own app, with or without a process id', async () => {
    const { proxy, handlers } = setup();
    await expect(handlers.fetch({ sender: APP_ID, payload: { url: API } })).resolves.toEqual({
      returnValue: true,
    });
    await handlers.fetch({ sender: `${APP_ID} 99`, payload: { url: API } });
    expect(proxy.fetch).toHaveBeenCalledTimes(2);
    expect(proxy.fetch).toHaveBeenCalledWith({ url: API });
  });

  it.each(['com.other.app', `${APP_ID}.evil`, undefined, ''])(
    'refuses fetch from %j and sends nothing',
    async (sender) => {
      const { proxy, handlers } = setup();
      await expect(handlers.fetch({ sender, payload: { url: API } })).resolves.toEqual({
        returnValue: false,
        errorText: 'caller not allowed',
      });
      expect(proxy.fetch).not.toHaveBeenCalled();
    },
  );

  it('maps a rejected proxy call to returnValue false', async () => {
    const proxy = { fetch: () => Promise.reject(new Error('boom')) };
    const handlers = createHandlers({ appId: APP_ID, proxy });
    await expect(handlers.fetch({ sender: APP_ID })).resolves.toEqual({
      returnValue: false,
      errorText: 'boom',
    });
  });

  it('answers ping for any caller with node and the sender as received, and nothing else', () => {
    const { handlers } = setup();
    expect(handlers.ping({ sender: 'com.other.app' })).toEqual({
      returnValue: true,
      node: process.version,
      sender: 'com.other.app',
    });
    expect(handlers.ping({ sender: `${APP_ID} 1234` })).toEqual({
      returnValue: true,
      node: process.version,
      sender: `${APP_ID} 1234`,
    });
  });
});

describe('guarded lookup details', () => {
  type Cb = (err: Error | null, address?: unknown, family?: number) => void;

  it('forwards the caller options to the real lookup unchanged', () => {
    const received: unknown[] = [];
    const real = (_h: string, opts: unknown, cb: Cb) => {
      received.push(opts);
      cb(null, '93.184.216.34', 4);
    };
    const options = { all: false, family: 4, hints: 1024 };
    createGuardedLookup(real)('silo.example.test', options, () => {});
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(options);
    const all = { all: true, family: 4, hints: 32 };
    createGuardedLookup(real)('silo.example.test', all, () => {});
    expect(received[1]).toBe(all);
  });

  it('refuses an all:true result with a blocked address in the middle', async () => {
    const real = (_h: string, _o: unknown, cb: Cb) =>
      cb(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
        { address: '93.184.216.35', family: 4 },
      ]);
    const err = await new Promise<Error | null>((resolve) =>
      createGuardedLookup(real)('h.example.test', { all: true }, (e: Error | null) => resolve(e)),
    );
    expect(err?.message).toMatch(/blocked/);
  });

  it('passes address and family through for a non-all lookup', async () => {
    const real = (_h: string, _o: unknown, cb: Cb) => cb(null, '93.184.216.34', 4);
    const args = await new Promise<unknown[]>((resolve) =>
      createGuardedLookup(real)('h.example.test', {}, (...a: unknown[]) => resolve(a)),
    );
    expect(args).toEqual([null, '93.184.216.34', 4]);
  });
});

describe('isBlockedHost edge cases', () => {
  it.each(['::127.0.0.1', '::169.254.1.1'])('blocks the IPv4-compatible form %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(['1:2:3', 'zz::1', '1:2:3:4:5:6:7:8::', '::ffff:300.1.1.1'])(
    'fails closed on the unparsable literal %s',
    (host) => {
      expect(isBlockedHost(host)).toBe(true);
    },
  );
});

describe('raw path edge cases', () => {
  it('refuses a backslash in the authority', async () => {
    const { transport, sent } = fakeTransport({});
    const result = await createProxy(transport).fetch({
      url: 'https://silo.example.test\\api/v2/x',
    });
    expect(result).toMatchObject({ returnValue: false });
    expect(sent).toHaveLength(0);
  });

  it('does not check the fragment', async () => {
    const { transport } = fakeTransport({});
    expect(
      await createProxy(transport).fetch({ url: 'https://silo.example.test/api/v2/x#a%2fb' }),
    ).toMatchObject({ returnValue: true });
  });
});

describe('isAllowedCaller with an empty app ID', () => {
  it('refuses an empty sender for an empty app ID', () => {
    expect(isAllowedCaller('', '')).toBe(false);
  });
});
