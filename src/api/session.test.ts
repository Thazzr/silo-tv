import { HttpResponse, delay, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatform } from '../platform';
import { BASE_URL, account, problem } from '../test/apiFixtures';
import { createSiloClient } from './client';
import type { components } from './generated/schema';
import { Session } from './session';
import { directTransport, type Transport } from './transport';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => localStorage.clear());

const device = { id: 'b'.repeat(32), name: 'LG webOS TV' };
const ME = `${BASE_URL}/api/v2/account/me`;
const REFRESH = `${BASE_URL}/api/v2/auth/refresh`;

function problemJson(code: string, status: number, headers: Record<string, string> = {}) {
  return HttpResponse.json(problem(code, status), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}

function signedInSession() {
  const session = new Session(getPlatform().storage);
  session.set({
    accessToken: 'old',
    refreshToken: 'refresh-old',
    expiresAt: Date.now() + 3600_000,
    user: account,
  });
  return session;
}

function setup(session = signedInSession()) {
  const client = createSiloClient({
    baseUrl: BASE_URL,
    transport: directTransport,
    session,
    device,
    clientVersion: 'test',
  });
  return { client, session };
}

/** `me` answers 200 only for the new token; the old one gets the given problem code. */
function mockAuth(code: string, refreshed: () => Response | Promise<Response>) {
  const calls = { me: [] as (string | null)[], refresh: [] as unknown[] };
  server.use(
    http.get(ME, ({ request }) => {
      const auth = request.headers.get('Authorization');
      calls.me.push(auth);
      return auth === 'Bearer new' ? HttpResponse.json(account) : problemJson(code, 401);
    }),
    http.post(REFRESH, async ({ request }) => {
      calls.refresh.push(await request.json());
      return refreshed();
    }),
  );
  return calls;
}

const newTokens: components['schemas']['RefreshedTokens'] = {
  access_token: 'new',
  refresh_token: 'refresh-new',
  expires_in: 3600,
};

describe('refresh on 401', () => {
  it.each(['token_refresh_required', 'invalid_token'])(
    'two parallel requests failing with %s cause exactly one refresh and one retry each',
    async (code) => {
      const calls = mockAuth(code, async () => {
        await delay(30);
        return HttpResponse.json(newTokens);
      });
      const { client, session } = setup();

      const [a, b] = await Promise.all([
        client.GET('/api/v2/account/me'),
        client.GET('/api/v2/account/me'),
      ]);

      expect(a.response.status).toBe(200);
      expect(b.response.status).toBe(200);
      expect(a.data?.id).toBe('user-1');
      expect(calls.refresh).toEqual([{ refresh_token: 'refresh-old' }]);
      // Two failed attempts with the old token, then exactly one retry each with the new one.
      expect(calls.me.filter((auth) => auth === 'Bearer old')).toHaveLength(2);
      expect(calls.me.filter((auth) => auth === 'Bearer new')).toHaveLength(2);
      expect(session.get()).toMatchObject({ accessToken: 'new', refreshToken: 'refresh-new' });
      expect(session.get()?.user).toEqual(account);
      expect(session.get()!.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
    },
  );

  it('replays the request body on the retry', async () => {
    const bodies: string[] = [];
    const transport: Transport = async (request) => {
      if (request.url.endsWith('/api/v2/auth/refresh')) {
        return new Response(JSON.stringify(newTokens), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      bodies.push(await request.text());
      return request.headers.get('Authorization') === 'Bearer new'
        ? new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(problem('token_refresh_required', 401)), {
            status: 401,
            headers: { 'Content-Type': 'application/problem+json' },
          });
    };
    const client = createSiloClient({
      baseUrl: BASE_URL,
      transport,
      session: signedInSession(),
      device,
      clientVersion: 'test',
    });
    await client.POST('/api/v2/auth/device/poll', { body: { device_code: 'dc' } });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe('{"device_code":"dc"}');
    expect(bodies[1]).toBe(bodies[0]);
  });

  it('does not retry a second 401 after the retry', async () => {
    const calls = { me: 0, refresh: 0 };
    server.use(
      http.get(ME, () => {
        calls.me += 1;
        return problemJson('token_refresh_required', 401);
      }),
      http.post(REFRESH, () => {
        calls.refresh += 1;
        return HttpResponse.json(newTokens);
      }),
    );
    const { client, session } = setup();
    const { response } = await client.GET('/api/v2/account/me');
    expect(response.status).toBe(401);
    expect(calls).toEqual({ me: 2, refresh: 1 });
    expect(session.get()?.accessToken).toBe('new');
  });

  it('signs out when the refresh is refused and emits signedOut once', async () => {
    const calls = mockAuth('token_refresh_required', () => problemJson('session_expired', 401));
    const { client, session } = setup();
    const signedOut = vi.fn();
    session.on('signedOut', signedOut);

    const [a, b] = await Promise.all([
      client.GET('/api/v2/account/me'),
      client.GET('/api/v2/account/me'),
    ]);

    expect(a.response.status).toBe(401);
    expect(b.response.status).toBe(401);
    expect(calls.refresh).toHaveLength(1);
    expect(calls.me).toHaveLength(2);
    expect(session.get()).toBeNull();
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it('keeps the tokens on a 503 and hands the retryable error to the caller', async () => {
    const calls = mockAuth('token_refresh_required', () =>
      problemJson('dependency_unavailable', 503, { 'Retry-After': '5' }),
    );
    const { client, session } = setup();
    const signedOut = vi.fn();
    session.on('signedOut', signedOut);

    const { response, error } = await client.GET('/api/v2/account/me');

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(error).toMatchObject({ status: 503 });
    expect(calls.refresh).toHaveLength(1);
    expect(calls.me).toHaveLength(1);
    expect(session.get()).toMatchObject({ accessToken: 'old', refreshToken: 'refresh-old' });
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('does not refresh for other 401 problems or without a session', async () => {
    let refreshes = 0;
    server.use(
      http.get(ME, () => problemJson('invalid_credentials', 401)),
      http.post(REFRESH, () => {
        refreshes += 1;
        return HttpResponse.json(newTokens);
      }),
    );
    const { client } = setup();
    expect((await client.GET('/api/v2/account/me')).response.status).toBe(401);
    const anonymous = setup(new Session(null)).client;
    expect((await anonymous.GET('/api/v2/account/me')).response.status).toBe(401);
    expect(refreshes).toBe(0);
  });

  it('sends the refresh call without credentials but with the device headers', async () => {
    let headers: Headers | undefined;
    server.use(
      http.get(ME, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer new'
          ? HttpResponse.json(account)
          : problemJson('token_refresh_required', 401),
      ),
      http.post(REFRESH, ({ request }) => {
        headers = request.headers;
        return HttpResponse.json(newTokens);
      }),
    );
    await setup().client.GET('/api/v2/account/me');
    expect(headers?.get('Authorization')).toBeNull();
    expect(headers?.get('X-Silo-Device-Id')).toBe(device.id);
  });
});

describe('proactive refresh', () => {
  /** A session as after a relaunch: refresh token only, no access token yet. */
  function relaunched() {
    localStorage.setItem(
      'silo-tv.session.v1',
      JSON.stringify({ v: 2, session: { refreshToken: 'refresh-old', user: account } }),
    );
    return new Session(getPlatform().storage);
  }

  function mockNew() {
    const calls = { me: [] as (string | null)[], refresh: 0 };
    server.use(
      http.get(ME, ({ request }) => {
        calls.me.push(request.headers.get('Authorization'));
        return HttpResponse.json(account);
      }),
      http.post(REFRESH, async () => {
        calls.refresh += 1;
        await delay(20);
        return HttpResponse.json(newTokens);
      }),
    );
    return calls;
  }

  it('refreshes once before the first call after a relaunch; parallel calls share it', async () => {
    const calls = mockNew();
    const { client } = setup(relaunched());
    const results = await Promise.all([
      client.GET('/api/v2/account/me'),
      client.GET('/api/v2/account/me'),
      client.GET('/api/v2/account/me'),
    ]);
    expect(results.map((r) => r.response.status)).toEqual([200, 200, 200]);
    expect(calls.refresh).toBe(1);
    expect(calls.me).toEqual(['Bearer new', 'Bearer new', 'Bearer new']);
  });

  it('refreshes a token that expires within a minute before sending', async () => {
    const calls = mockNew();
    const session = signedInSession();
    session.update({ expiresAt: Date.now() + 30_000 });
    await setup(session).client.GET('/api/v2/account/me');
    expect(calls.refresh).toBe(1);
    expect(calls.me).toEqual(['Bearer new']);
  });

  it('does not refresh a token that is good for more than a minute', async () => {
    const calls = mockNew();
    await setup().client.GET('/api/v2/account/me');
    expect(calls.refresh).toBe(0);
    expect(calls.me).toEqual(['Bearer old']);
  });

  it('hands a 503 back without sending the request when there is no access token', async () => {
    const calls = { me: 0 };
    server.use(
      http.get(ME, () => {
        calls.me += 1;
        return HttpResponse.json(account);
      }),
      http.post(REFRESH, () => problemJson('dependency_unavailable', 503, { 'Retry-After': '5' })),
    );
    const session = relaunched();
    const { response } = await setup(session).client.GET('/api/v2/account/me');
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(calls.me).toBe(0);
    expect(session.get()?.refreshToken).toBe('refresh-old');
  });

  it('lets a network failure of the refresh through when there is no access token', async () => {
    const calls = { me: 0 };
    server.use(
      http.get(ME, () => {
        calls.me += 1;
        return HttpResponse.json(account);
      }),
      http.post(REFRESH, () => HttpResponse.error()),
    );
    const session = relaunched();
    await expect(setup(session).client.GET('/api/v2/account/me')).rejects.toBeInstanceOf(TypeError);
    expect(calls.me).toBe(0);
    expect(session.get()?.refreshToken).toBe('refresh-old');
  });

  it('still sends a near-expiry token when the refresh answers 503', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(ME, ({ request }) => {
        seen.push(request.headers.get('Authorization'));
        return HttpResponse.json(account);
      }),
      http.post(REFRESH, () => problemJson('dependency_unavailable', 503)),
    );
    const session = signedInSession();
    session.update({ expiresAt: Date.now() + 30_000 });
    const { response } = await setup(session).client.GET('/api/v2/account/me');
    expect(response.status).toBe(200);
    expect(seen).toEqual(['Bearer old']);
    expect(session.get()?.refreshToken).toBe('refresh-old');
  });

  it('signs out when the proactive refresh is refused', async () => {
    server.use(http.post(REFRESH, () => problemJson('session_expired', 401)));
    const session = relaunched();
    const { response } = await setup(session).client.GET('/api/v2/account/me');
    expect(response.status).toBe(401);
    expect(session.get()).toBeNull();
  });
});

describe('Session', () => {
  const STORED = 'silo-tv.session.v1';

  it('stores v2 without the access token or its expiry', () => {
    signedInSession();
    expect(Object.keys({ ...localStorage })).toEqual([STORED]);
    const raw = localStorage.getItem(STORED)!;
    expect(JSON.parse(raw)).toEqual({
      v: 2,
      session: { refreshToken: 'refresh-old', user: account },
    });
    expect(raw).not.toContain('accessToken');
    expect(raw).not.toContain('expiresAt');
    expect(raw).not.toContain('"old"');
  });

  it('loads v2 as a session with no access token yet', () => {
    signedInSession();
    expect(new Session(getPlatform().storage).get()).toEqual({
      accessToken: '',
      refreshToken: 'refresh-old',
      expiresAt: 0,
      user: account,
    });
  });

  it('migrates a v1 record: keeps the refresh token and rewrites it as v2 at once', () => {
    localStorage.setItem(
      STORED,
      JSON.stringify({
        v: 1,
        session: {
          accessToken: 'old-access',
          refreshToken: 'r',
          expiresAt: 5,
          user: account,
          profileId: 'p1',
          profileToken: 'pt',
        },
      }),
    );
    const session = new Session(getPlatform().storage);
    expect(session.get()).toEqual({
      accessToken: '',
      refreshToken: 'r',
      expiresAt: 0,
      user: account,
      profileId: 'p1',
      profileToken: 'pt',
    });
    const raw = localStorage.getItem(STORED)!;
    expect(raw).not.toContain('old-access');
    expect(JSON.parse(raw)).toEqual({
      v: 2,
      session: { refreshToken: 'r', user: account, profileId: 'p1', profileToken: 'pt' },
    });
  });

  it('rejects a record of an unknown version or without a refresh token', () => {
    const valid = { refreshToken: 'r' };
    localStorage.setItem(STORED, JSON.stringify({ v: 3, session: valid }));
    expect(new Session(getPlatform().storage).get()).toBeNull();
    localStorage.setItem(STORED, JSON.stringify({ session: valid }));
    expect(new Session(getPlatform().storage).get()).toBeNull();
    localStorage.setItem(STORED, JSON.stringify(valid));
    expect(new Session(getPlatform().storage).get()).toBeNull();
    localStorage.setItem(STORED, JSON.stringify({ v: 2, session: {} }));
    expect(new Session(getPlatform().storage).get()).toBeNull();
    localStorage.setItem(STORED, 'not json');
    expect(new Session(getPlatform().storage).get()).toBeNull();
  });

  it('signOut clears storage, notifies once and is a no-op when already signed out', () => {
    const session = signedInSession();
    const signedOut = vi.fn();
    session.on('signedOut', signedOut);
    session.signOut();
    session.signOut();
    expect(session.get()).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });
});
