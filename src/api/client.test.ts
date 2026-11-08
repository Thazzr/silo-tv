import { describe, expect, it } from 'vitest';
import { BASE_URL, account, systemInfo } from '../test/apiFixtures';
import { createSiloClient, toApiError } from './client';
import { Session } from './session';
import type { Transport } from './transport';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

const device = { id: 'a'.repeat(32), name: 'LG webOS TV' };

function setup(session = new Session(memoryStorage())) {
  const seen: Request[] = [];
  const transport: Transport = async (request) => {
    seen.push(request.clone());
    return new Response(JSON.stringify(systemInfo), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const client = createSiloClient({
    baseUrl: BASE_URL,
    transport,
    session,
    device,
    clientVersion: '1.2.3',
  });
  return { client, seen, session };
}

const signedIn = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 3600_000,
  user: account,
};

describe('device headers', () => {
  it('are set on every request, also without a session', async () => {
    const { client, seen } = setup();
    await client.GET('/api/v2/system/info');
    await client.GET('/api/v2/system/info');
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request.url).toBe(`${BASE_URL}/api/v2/system/info`);
      expect(request.headers.get('X-Silo-Device-Id')).toBe(device.id);
      expect(request.headers.get('X-Silo-Device-Name')).toBe('LG webOS TV');
      expect(request.headers.get('X-Silo-Device-Platform')).toBe('webos');
      expect(request.headers.get('X-Silo-Client')).toBe('silo-tv');
      expect(request.headers.get('X-Silo-Client-Version')).toBe('1.2.3');
    }
  });

  it('keep the device name header printable ASCII', async () => {
    const seen: Request[] = [];
    const client = createSiloClient({
      baseUrl: BASE_URL,
      transport: async (request) => {
        seen.push(request);
        return new Response('{}');
      },
      session: new Session(null),
      device: { id: device.id, name: 'LG TV äö' },
    });
    await client.GET('/api/v2/system/info');
    expect(seen[0]?.headers.get('X-Silo-Device-Name')).toBe('LG TV');
  });
});

describe('auth headers', () => {
  it('are absent without a session', async () => {
    const { client, seen } = setup();
    await client.GET('/api/v2/system/info');
    const headers = seen[0]!.headers;
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Profile-Id')).toBeNull();
    expect(headers.get('X-Profile-Token')).toBeNull();
  });

  it('carry the bearer token, and the profile only when selected', async () => {
    const session = new Session(memoryStorage());
    session.set(signedIn);
    const { client, seen } = setup(session);
    await client.GET('/api/v2/system/info');
    expect(seen[0]!.headers.get('Authorization')).toBe('Bearer access-1');
    expect(seen[0]!.headers.get('X-Profile-Id')).toBeNull();

    session.update({ profileId: 'p1' });
    await client.GET('/api/v2/system/info');
    expect(seen[1]!.headers.get('X-Profile-Id')).toBe('p1');
    expect(seen[1]!.headers.get('X-Profile-Token')).toBeNull();

    session.update({ profileToken: 'pt' });
    await client.GET('/api/v2/system/info');
    expect(seen[2]!.headers.get('X-Profile-Token')).toBe('pt');
  });
});

describe('typed calls', () => {
  it('return typed data and reject paths outside the allowlist at compile time', async () => {
    const { client } = setup();
    const { data } = await client.GET('/api/v2/system/info');
    expect(data?.api_major).toBe(2);

    // The generated schema only contains the allowlisted operations.
    // @ts-expect-error not an allowlisted path
    const call = () => client.GET('/api/v2/admin/users');
    expect(typeof call).toBe('function');
  });
});

describe('toApiError', () => {
  it('builds a SiloApiError from an openapi-fetch error result', () => {
    const response = new Response(null, { status: 503, headers: { 'Retry-After': '7' } });
    const error = toApiError(
      { type: 'https://x/problems/dependency_unavailable', title: 'T', detail: 'D' },
      response,
    );
    expect(error).toMatchObject({
      status: 503,
      code: 'dependency_unavailable',
      title: 'T',
      detail: 'D',
      retryAfter: 7,
    });
  });
});
