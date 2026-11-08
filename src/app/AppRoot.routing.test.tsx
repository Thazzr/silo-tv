import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTransportMode, setTransportMode } from '../api/transport';
import { Session } from '../api/session';
import { serviceFetch } from '../platform/serviceFetch';
import { BASE_URL, account } from '../test/apiFixtures';
import { capability, catalogPage, library, profile, profileCollection } from '../test/flowFixtures';
import { makeReport } from '../test/probeFixture';
import { memoryStorage, renderApp, testDevice } from '../test/renderFlow';
import { AppRoot } from './AppRoot';
import { saveServer } from './serverStore';

vi.mock('../platform/serviceFetch', () => ({
  serviceFetch: vi.fn(),
  servicePing: vi.fn(),
  APP_ID: 'io.github.thazzr.silolg',
  SERVICE_ID: 'io.github.thazzr.silolg.service',
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setTransportMode('direct');
  vi.mocked(serviceFetch).mockReset();
});
afterAll(() => server.close());

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

const probe = () => Promise.resolve(makeReport());
const json = (body: unknown) => HttpResponse.json(body as Record<string, unknown>);

function signedInSession(profileId?: string) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    ...(profileId ? { profileId } : {}),
  });
  return session;
}

describe('AppRoot routing', () => {
  it('shows the probe screen when the probe parameter is set', () => {
    renderApp(<AppRoot launch={{ probe: '' }} probe={probe} storage={storage} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Platform' })).toBeInTheDocument();
    expect(screen.queryByTestId('server-screen')).not.toBeInTheDocument();
  });

  it('shows the server screen without a stored server', () => {
    renderApp(<AppRoot launch={{}} probe={probe} storage={storage} device={testDevice} />);
    expect(screen.getByTestId('server-screen')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Platform' })).not.toBeInTheDocument();
  });

  it('pre-fills the server from the launch parameter', () => {
    renderApp(
      <AppRoot
        launch={{ server: 'silo.example.test' }}
        storage={storage}
        device={testDevice}
        session={new Session(memoryStorage())}
      />,
    );
    expect(screen.getByLabelText('Server address')).toHaveValue('silo.example.test');
  });

  it('shows the server screen first when a server is given at launch, even with a stored one', () => {
    saveServer(BASE_URL, storage);
    renderApp(
      <AppRoot
        launch={{ server: 'other.example.test' }}
        storage={storage}
        device={testDevice}
        session={signedInSession('p1')}
      />,
    );
    expect(screen.getByLabelText('Server address')).toHaveValue('other.example.test');
  });

  it('sets the transport mode from the launch parameter before the first request', async () => {
    saveServer(BASE_URL, storage);
    vi.mocked(serviceFetch).mockResolvedValue({
      returnValue: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...capability, state: 'disabled' }),
    });
    expect(getTransportMode()).toBe('direct');
    renderApp(
      <AppRoot
        launch={{ transport: 'service' }}
        storage={storage}
        device={testDevice}
        session={new Session(memoryStorage())}
      />,
    );
    expect(getTransportMode()).toBe('service');
    // The sign-in screen's first request already goes through the JS service (no MSW handler
    // exists, so a direct request would fail the test).
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(vi.mocked(serviceFetch).mock.calls[0]?.[0].url).toBe(
      `${BASE_URL}/api/v2/auth/device/capability`,
    );
  });

  it('keeps the direct transport without a transport parameter', () => {
    renderApp(<AppRoot launch={{}} storage={storage} device={testDevice} />);
    expect(getTransportMode()).toBe('direct');
  });

  it('starts at the sign-in screen with a stored server and no session', async () => {
    saveServer(BASE_URL, storage);
    server.use(
      http.get(`${BASE_URL}/api/v2/auth/device/capability`, () =>
        json({ ...capability, state: 'disabled' }),
      ),
    );
    renderApp(
      <AppRoot
        launch={{}}
        storage={storage}
        device={testDevice}
        session={new Session(memoryStorage())}
      />,
    );
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
  });

  it('starts at the profile list with a session without a profile', async () => {
    saveServer(BASE_URL, storage);
    server.use(
      http.get(`${BASE_URL}/api/v2/profiles`, () =>
        json(
          profileCollection([
            profile({ id: 'p1', name: 'Alex' }),
            profile({ id: 'p2', name: 'Sam', is_primary: false }),
          ]),
        ),
      ),
    );
    renderApp(
      <AppRoot launch={{}} storage={storage} device={testDevice} session={signedInSession()} />,
    );
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
  });

  it('starts at the library with a session that has a profile', async () => {
    saveServer(BASE_URL, storage);
    server.use(
      http.get(`${BASE_URL}/api/v2/user/libraries`, () => json({ items: [library()] })),
      http.get(`${BASE_URL}/api/v2/catalog`, () => json(catalogPage([]))),
    );
    renderApp(
      <AppRoot launch={{}} storage={storage} device={testDevice} session={signedInSession('p1')} />,
    );
    expect(await screen.findByText('This library is empty.')).toBeInTheDocument();
  });
});
