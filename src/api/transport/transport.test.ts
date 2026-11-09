import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSiloClient } from '../client';
import { Session } from '../session';
import { memoryStorage } from '../../test/renderFlow';
import { fake, installFakeBridge, lunaUri } from '../../test/fakeBridge';
import { getPlatform, setPlatformForTests } from '../../platform';
import {
  currentTransport,
  directTransport,
  getTransportMode,
  selectTransport,
  serviceTransport,
  setTransportMode,
} from '.';

const URL_ = 'https://silo.example.test/api/v2/x';
// Id of the bundled JS service (the app ID plus .service).
const SERVICE_ID = 'io.github.thazzr.silotv.service';

afterEach(() => {
  vi.unstubAllGlobals();
  setPlatformForTests(null);
  setTransportMode('direct');
});

function respond(payload: object) {
  fake.responders.set(lunaUri(SERVICE_ID, 'fetch'), () => JSON.stringify(payload));
}

describe('directTransport', () => {
  it('uses the global fetch with credentials omitted', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);
    const request = new Request(URL_);
    await directTransport(request);
    expect(spy).toHaveBeenCalledWith(request, {
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    });
  });

  describe('timeout', () => {
    afterEach(() => vi.useRealTimers());

    // A fetch that never answers but honours its signal, like the browser's.
    const hangingFetch = () =>
      vi.fn(
        (_input: Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );

    it('rejects a request nobody answers after 30 s with a network-failure TypeError', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', hangingFetch());
      const result = directTransport(new Request(URL_)).then(
        () => 'resolved',
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(29_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      const error = await result;
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toMatch(/no answer within 30 s/);
    });

    it('still aborts when the caller aborts, and leaves no timer behind', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', hangingFetch());
      const caller = new AbortController();
      const result = directTransport(new Request(URL_, { signal: caller.signal })).then(
        () => 'resolved',
        (error: unknown) => error,
      );
      caller.abort();
      const error = await result;
      expect((error as Error).name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(TypeError);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears its timer when the request answers in time', async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('ok')),
      );
      await directTransport(new Request(URL_));
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not call the refresh endpoint or sign out when a request times out', async () => {
      vi.useFakeTimers();
      const urls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((input: Request, init?: RequestInit) => {
          urls.push(input.url);
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }),
      );
      const session = new Session(memoryStorage());
      session.set({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 3600_000,
      });
      const signOut = vi.spyOn(session, 'signOut');
      const client = createSiloClient({
        baseUrl: 'https://silo.example.test',
        transport: directTransport,
        session,
        device: { id: 'd'.repeat(32), name: 'tv' },
      });
      const result = client
        .GET('/api/v2/home/capabilities', { params: { header: { 'X-Profile-Id': 'p' } } })
        .then(
          () => 'resolved',
          (error: unknown) => error,
        );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toBeInstanceOf(TypeError);
      expect(urls.some((u) => u.includes('/auth/refresh'))).toBe(false);
      expect(signOut).not.toHaveBeenCalled();
    });

    it('times out the service transport too', async () => {
      vi.useFakeTimers();
      const platform = { proxyFetch: () => new Promise<never>(() => {}) };
      setPlatformForTests(platform as never);
      const result = serviceTransport(new Request(URL_)).then(
        () => 'resolved',
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toBeInstanceOf(TypeError);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('serviceTransport', () => {
  function setup() {
    fake.responders.clear();
    fake.calls.length = 0;
    installFakeBridge();
    // The platform is detected once; detect again now that the bridge exists.
    setPlatformForTests(null);
  }

  it('fails like a network error when the platform has no proxy service', async () => {
    expect(getPlatform().proxyFetch).toBeUndefined();
    await expect(serviceTransport(new Request(URL_))).rejects.toThrow(TypeError);
  });

  it('maps the request to a service call and the result back to a Response', async () => {
    setup();
    respond({
      returnValue: true,
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json', 'x-extra': '1' },
      body: '{"a":1}',
    });
    const response = await serviceTransport(
      new Request(URL_, {
        method: 'POST',
        headers: { 'X-Silo-Device-Id': 'dev', 'Content-Type': 'application/json' },
        body: '{"q":true}',
      }),
    );
    const params = fake.calls[0]?.params as Record<string, unknown>;
    expect(params).toMatchObject({
      url: URL_,
      method: 'POST',
      body: '{"q":true}',
      headers: { 'x-silo-device-id': 'dev', 'content-type': 'application/json' },
    });
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('x-extra')).toBe('1');
    expect(await response.text()).toBe('{"a":1}');
  });

  it('sends no body for GET and handles a null-body status', async () => {
    setup();
    respond({ returnValue: true, status: 204, statusText: 'No Content', headers: {}, body: '' });
    const response = await serviceTransport(new Request(URL_));
    expect(fake.calls[0]?.params).not.toHaveProperty('body');
    expect(response.status).toBe(204);
  });

  it('turns a service error into a network error (TypeError)', async () => {
    setup();
    respond({ returnValue: false, errorText: 'connect refused' });
    await expect(serviceTransport(new Request(URL_))).rejects.toThrow(TypeError);
  });

  it('returns a redirect as is instead of following it', async () => {
    setup();
    respond({
      returnValue: true,
      status: 302,
      statusText: 'Found',
      headers: { location: 'https://other.example.test/' },
      body: '',
    });
    const response = await serviceTransport(new Request(URL_));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://other.example.test/');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('transport selection', () => {
  it('selects by mode and defaults to direct', () => {
    expect(getTransportMode()).toBe('direct');
    expect(selectTransport('direct')).toBe(directTransport);
    expect(selectTransport('service')).toBe(serviceTransport);
  });

  it('currentTransport follows the mode at call time', async () => {
    const spy = vi.fn(async () => new Response('direct'));
    vi.stubGlobal('fetch', spy);
    await currentTransport(new Request(URL_));
    expect(spy).toHaveBeenCalledTimes(1);

    fake.responders.clear();
    installFakeBridge();
    setPlatformForTests(null);
    respond({ returnValue: true, status: 200, statusText: 'OK', headers: {}, body: 'svc' });
    setTransportMode('service');
    const response = await currentTransport(new Request(URL_));
    expect(await response.text()).toBe('svc');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
