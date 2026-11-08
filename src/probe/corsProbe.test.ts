import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_TIMEOUT_MS,
  corsVerdict,
  runCorsProbe,
  type CorsCheckId,
  type CorsCheckResult,
  type CorsOutcome,
  type CorsProbeDeps,
} from './corsProbe';

const SERVER = 'https://silo.example.test';

afterEach(() => vi.useRealTimers());

interface FetchCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (call: FetchCall) => Promise<unknown> | unknown) {
  const calls: FetchCall[] = [];
  const fn = vi.fn((url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(answer(call));
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

interface XhrCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeout: number;
}

type XhrBehaviour = 'load' | 'error' | 'timeout' | 'throw';

function fakeXhr(behaviour: XhrBehaviour = 'load', status = 200) {
  const calls: XhrCall[] = [];
  class FakeXhr {
    status = 0;
    timeout = 0;
    withCredentials = true;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private call: XhrCall = { method: '', url: '', headers: {}, body: undefined, timeout: 0 };
    open(method: string, url: string) {
      this.call.method = method;
      this.call.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.call.headers[name] = value;
    }
    send(body: unknown) {
      if (behaviour === 'throw') throw new Error('send failed');
      this.call.body = body;
      this.call.timeout = this.timeout;
      calls.push(this.call);
      queueMicrotask(() => {
        if (behaviour === 'load') {
          this.status = status;
          this.onload?.();
        } else if (behaviour === 'error') this.onerror?.();
        else this.ontimeout?.();
      });
    }
  }
  return { ctor: FakeXhr as unknown as typeof XMLHttpRequest, calls };
}

const okService = (status = 200) => vi.fn(() => Promise.resolve({ status }) as never);

function deps(overrides: CorsProbeDeps = {}): CorsProbeDeps {
  return {
    fetch: fakeFetch(() => ({ status: 200 })).fn,
    XMLHttpRequest: fakeXhr().ctor,
    serviceFetch: okService(),
    servicePing: vi.fn(() =>
      Promise.resolve({
        returnValue: true,
        node: 'v8.12.0',
        sender: 'io.github.test.app',
      } as const),
    ),
    isWebOS: () => true,
    ...overrides,
  };
}

function byId(results: CorsCheckResult[], id: CorsCheckId) {
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`no result ${id}`);
  return found;
}

describe('runCorsProbe request shapes', () => {
  it('sends the exact requests of the seven checks, in order', async () => {
    const f = fakeFetch(() => ({ status: 200 }));
    const x = fakeXhr();
    const sf = okService();
    const results = await runCorsProbe(
      SERVER,
      deps({ fetch: f.fn, XMLHttpRequest: x.ctor, serviceFetch: sf }),
    );
    expect(results.map((r) => [r.id, r.transport])).toEqual([
      ['direct-simple', 'fetch'],
      ['direct-preflight-get', 'fetch'],
      ['direct-preflight-post', 'fetch'],
      ['xhr-preflight-get', 'xhr'],
      ['service-ping', 'service'],
      ['service-get', 'service'],
      ['service-post', 'service'],
    ]);

    expect(f.calls.map((c) => [c.url, c.init.method, c.init.headers, c.init.body])).toEqual([
      [`${SERVER}/api/v2/system/info`, 'GET', {}, undefined],
      [
        `${SERVER}/api/v2/auth/device/capability`,
        'GET',
        { 'X-Silo-Device-Id': 'silo-lg-probe' },
        undefined,
      ],
      [
        `${SERVER}/api/v2/auth/refresh`,
        'POST',
        { 'Content-Type': 'application/json' },
        '{"refresh_token":"silo-lg-probe-invalid"}',
      ],
    ]);
    expect(f.calls.every((c) => c.init.credentials === 'omit')).toBe(true);

    expect(x.calls).toEqual([
      {
        method: 'GET',
        url: `${SERVER}/api/v2/auth/device/capability`,
        headers: { 'X-Silo-Device-Id': 'silo-lg-probe' },
        body: null,
        timeout: CHECK_TIMEOUT_MS,
      },
    ]);

    expect(sf.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      {
        url: `${SERVER}/api/v2/auth/device/capability`,
        method: 'GET',
        headers: { 'X-Silo-Device-Id': 'silo-lg-probe' },
        body: undefined,
        timeoutMs: CHECK_TIMEOUT_MS,
      },
      {
        url: `${SERVER}/api/v2/auth/refresh`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"refresh_token":"silo-lg-probe-invalid"}',
        timeoutMs: CHECK_TIMEOUT_MS,
      },
    ]);
  });

  it('never sends an Authorization header on any transport', async () => {
    const f = fakeFetch(() => ({ status: 200 }));
    const x = fakeXhr();
    const sf = okService();
    await runCorsProbe(SERVER, deps({ fetch: f.fn, XMLHttpRequest: x.ctor, serviceFetch: sf }));
    const headerSets = [
      ...f.calls.map((c) => c.init.headers),
      ...x.calls.map((c) => c.headers),
      ...sf.mock.calls.map((c) => ((c as unknown[])[0] as { headers: object }).headers),
    ] as Record<string, string>[];
    expect(headerSets).toHaveLength(6);
    for (const headers of headerSets) {
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    }
  });

  it('runs the checks one after another', async () => {
    let active = 0;
    let maxActive = 0;
    const f = fakeFetch(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return { status: 200 };
    });
    await runCorsProbe(SERVER, deps({ fetch: f.fn }));
    expect(maxActive).toBe(1);
  });
});

describe('runCorsProbe fetch classification', () => {
  it.each([200, 401, 405, 500])('reports any HTTP response (%i) as reached', async (status) => {
    const f = fakeFetch(() => ({ status }));
    const results = await runCorsProbe(SERVER, deps({ fetch: f.fn }));
    expect(byId(results, 'direct-simple')).toMatchObject({ outcome: 'reached', status });
  });

  it('reports a TypeError as blocked with its message', async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const results = await runCorsProbe(SERVER, deps({ fetch: f.fn }));
    expect(byId(results, 'direct-preflight-get')).toMatchObject({
      outcome: 'blocked',
      detail: 'Failed to fetch',
    });
  });

  it('reports other rejections as error', async () => {
    const f = fakeFetch(() => Promise.reject(new Error('boom')));
    const results = await runCorsProbe(SERVER, deps({ fetch: f.fn }));
    expect(byId(results, 'direct-simple')).toMatchObject({ outcome: 'error', detail: 'boom' });
  });

  it('reports a hung request as error "timeout" after 10 s', async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    let t = 0;
    const promise = runCorsProbe(
      SERVER,
      deps({ fetch: f as unknown as typeof fetch, now: () => t }),
    );
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    t = CHECK_TIMEOUT_MS;
    await vi.advanceTimersByTimeAsync(1);
    // The other two fetch checks hang as well.
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS * 2);
    const results = await promise;
    expect(byId(results, 'direct-simple')).toMatchObject({ outcome: 'error', detail: 'timeout' });
    expect(byId(results, 'direct-preflight-post').outcome).toBe('error');
  });

  it('measures the duration with the injected clock', async () => {
    let t = 1000;
    const f = fakeFetch(() => {
      t += 42;
      return { status: 200 };
    });
    const results = await runCorsProbe(SERVER, deps({ fetch: f.fn, now: () => t }));
    expect(byId(results, 'direct-simple').ms).toBe(42);
  });
});

describe('runCorsProbe XHR classification', () => {
  it('reports the status of a loaded response as reached', async () => {
    const results = await runCorsProbe(SERVER, deps({ XMLHttpRequest: fakeXhr('load', 403).ctor }));
    expect(byId(results, 'xhr-preflight-get')).toMatchObject({ outcome: 'reached', status: 403 });
  });

  it('reports onerror as blocked', async () => {
    const results = await runCorsProbe(SERVER, deps({ XMLHttpRequest: fakeXhr('error').ctor }));
    expect(byId(results, 'xhr-preflight-get').outcome).toBe('blocked');
  });

  it('reports ontimeout as error "timeout"', async () => {
    const results = await runCorsProbe(SERVER, deps({ XMLHttpRequest: fakeXhr('timeout').ctor }));
    expect(byId(results, 'xhr-preflight-get')).toMatchObject({
      outcome: 'error',
      detail: 'timeout',
    });
  });

  it('reports a throwing send as error', async () => {
    const results = await runCorsProbe(SERVER, deps({ XMLHttpRequest: fakeXhr('throw').ctor }));
    expect(byId(results, 'xhr-preflight-get')).toMatchObject({
      outcome: 'error',
      detail: 'send failed',
    });
  });
});

describe('runCorsProbe service classification', () => {
  it('marks the three service checks unavailable off webOS and never calls the service', async () => {
    const sf = okService();
    const ping = vi.fn();
    const results = await runCorsProbe(
      SERVER,
      deps({ isWebOS: () => false, serviceFetch: sf, servicePing: ping as never }),
    );
    for (const id of ['service-ping', 'service-get', 'service-post'] as const) {
      expect(byId(results, id).outcome).toBe('unavailable');
    }
    expect(sf).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports the Node version and the sender of the ping as detail', async () => {
    const results = await runCorsProbe(SERVER, deps());
    expect(byId(results, 'service-ping')).toMatchObject({
      outcome: 'reached',
      detail: 'node v8.12.0 · sender io.github.test.app',
    });
  });

  it('reports the HTTP status from the service as reached', async () => {
    const results = await runCorsProbe(SERVER, deps({ serviceFetch: okService(401) }));
    expect(byId(results, 'service-post')).toMatchObject({ outcome: 'reached', status: 401 });
  });

  it('reports a service failure as error with its text', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED')));
    const results = await runCorsProbe(
      SERVER,
      deps({ serviceFetch: failing as never, servicePing: failing as never }),
    );
    for (const id of ['service-ping', 'service-get', 'service-post'] as const) {
      expect(byId(results, id)).toMatchObject({
        outcome: 'error',
        detail: 'connect ECONNREFUSED',
      });
    }
  });
});

describe('corsVerdict', () => {
  function results(outcomes: Partial<Record<CorsCheckId, CorsOutcome>>): CorsCheckResult[] {
    return Object.entries(outcomes).map(([id, outcome]) => ({
      id: id as CorsCheckId,
      transport: 'fetch',
      outcome,
      ms: 0,
    }));
  }

  it('is direct when both direct preflight checks reached', () => {
    expect(
      corsVerdict(
        results({
          'direct-preflight-get': 'reached',
          'direct-preflight-post': 'reached',
          'service-get': 'reached',
          'service-post': 'reached',
        }),
      ),
    ).toBe('direct');
  });

  it('is service when the direct checks fail but both service requests reached', () => {
    expect(
      corsVerdict(
        results({
          'direct-preflight-get': 'blocked',
          'direct-preflight-post': 'blocked',
          'service-get': 'reached',
          'service-post': 'reached',
        }),
      ),
    ).toBe('service');
  });

  it('is not direct when only one direct preflight check reached', () => {
    expect(
      corsVerdict(
        results({ 'direct-preflight-get': 'reached', 'direct-preflight-post': 'blocked' }),
      ),
    ).toBe('none');
  });

  it('is not service when only one service request reached', () => {
    expect(corsVerdict(results({ 'service-get': 'reached', 'service-post': 'error' }))).toBe(
      'none',
    );
  });

  it('is none for an empty result list', () => {
    expect(corsVerdict([])).toBe('none');
  });
});

// The literal 10_000 is deliberate: asserting against CHECK_TIMEOUT_MS would follow a mutation.
describe('runCorsProbe timeout threshold (10 s)', () => {
  it('keeps a hanging fetch pending at 9_999 ms and times it out at 10_000 ms', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const promise = runCorsProbe(SERVER, deps({ fetch: hanging as unknown as typeof fetch }));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(signals[0]?.aborted).toBe(false);
    expect(hanging).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    // The next check only starts once the first one has resolved.
    expect(hanging).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20_000);
    const results = await promise;
    expect(byId(results, 'direct-simple')).toMatchObject({ outcome: 'error', detail: 'timeout' });
  });

  it('sets xhr.timeout to 10_000 before send', async () => {
    const x = fakeXhr();
    await runCorsProbe(SERVER, deps({ XMLHttpRequest: x.ctor }));
    expect(x.calls[0]?.timeout).toBe(10_000);
  });

  it('passes timeoutMs 10_000 to both service requests', async () => {
    const sf = okService();
    await runCorsProbe(SERVER, deps({ serviceFetch: sf }));
    const timeouts = sf.mock.calls.map(
      (c) => ((c as unknown[])[0] as { timeoutMs: number }).timeoutMs,
    );
    expect(timeouts).toEqual([10_000, 10_000]);
  });
});
