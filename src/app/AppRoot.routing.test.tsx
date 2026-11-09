import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTransportMode, setTransportMode } from '../api/transport';
import { getPlatform, setPlatformForTests, type KeyValueStore } from '../platform';
import { BASE_URL, account } from '../test/apiFixtures';
import { capability, profile, profileCollection } from '../test/flowFixtures';
import { homeCapabilities } from '../test/homeFixtures';
import { ProfileLaunchPrefs } from '../features/profiles/launchPrefs';
import { makeReport } from '../test/probeFixture';
import { memoryStorage, renderApp, testDevice } from '../test/renderFlow';
import { AppRoot } from './AppRoot';
import { ServerRegistry } from './servers';

// The service transport goes through the platform's proxy; a spy stands in for the JS service.
const serviceFetch = vi.fn();

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setTransportMode('direct');
  serviceFetch.mockReset();
});
afterAll(() => server.close());

let storage: KeyValueStore;
let registry: ServerRegistry;
beforeEach(() => {
  setPlatformForTests({ ...getPlatform(), proxyFetch: serviceFetch });
  storage = memoryStorage();
  registry = new ServerRegistry(storage);
});

const probe = () => Promise.resolve(makeReport());
const json = (body: unknown) => HttpResponse.json(body as Record<string, unknown>);

/** Saves the test server and signs in to it, with a profile when given. */
function saveSignedIn(profileId?: string) {
  registry.add(BASE_URL);
  registry.session(BASE_URL).set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    ...(profileId ? { profileId } : {}),
  });
}

describe('AppRoot routing', () => {
  it('shows the probe screen when the probe parameter is set', () => {
    renderApp(
      <AppRoot launch={{ probe: '' }} probe={probe} registry={registry} storage={storage} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Platform' })).toBeInTheDocument();
    expect(screen.queryByTestId('server-screen')).not.toBeInTheDocument();
  });

  it('shows the server screen without a stored server', () => {
    renderApp(
      <AppRoot
        launch={{}}
        probe={probe}
        registry={registry}
        storage={storage}
        device={testDevice}
      />,
    );
    expect(screen.getByTestId('server-screen')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Platform' })).not.toBeInTheDocument();
  });

  it('pre-fills the server from the launch parameter', () => {
    renderApp(
      <AppRoot
        launch={{ server: 'silo.example.test' }}
        registry={registry}
        storage={storage}
        device={testDevice}
      />,
    );
    expect(screen.getByLabelText('Server address')).toHaveValue('silo.example.test');
  });

  it('shows the server screen first when a server is given at launch, even with a stored one', () => {
    saveSignedIn('p1');
    renderApp(
      <AppRoot
        launch={{ server: 'other.example.test' }}
        registry={registry}
        storage={storage}
        device={testDevice}
      />,
    );
    expect(screen.getByLabelText('Server address')).toHaveValue('other.example.test');
  });

  it('sets the transport mode from the launch parameter before the first request', async () => {
    registry.add(BASE_URL);
    serviceFetch.mockResolvedValue({
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
        registry={registry}
        storage={storage}
        device={testDevice}
      />,
    );
    expect(getTransportMode()).toBe('service');
    // The sign-in screen's first request already goes through the JS service (no MSW handler
    // exists, so a direct request would fail the test).
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    await waitFor(() => expect(serviceFetch).toHaveBeenCalled());
    const urls = serviceFetch.mock.calls.map((call) => (call[0] as { url: string }).url);
    expect(urls).toContain(`${BASE_URL}/api/v2/auth/device/capability`);
    expect(urls).toContain(`${BASE_URL}/api/v2/theme/branding`);
  });

  it('keeps the direct transport without a transport parameter', () => {
    renderApp(<AppRoot launch={{}} registry={registry} storage={storage} device={testDevice} />);
    expect(getTransportMode()).toBe('direct');
  });

  it('starts at the sign-in screen with a single saved server and no session', async () => {
    registry.add(BASE_URL);
    server.use(
      http.get(`${BASE_URL}/api/v2/auth/device/capability`, () =>
        json({ ...capability, state: 'disabled' }),
      ),
      http.get(`${BASE_URL}/api/v2/auth/providers`, () =>
        json({ items: [], password_login: false }),
      ),
      http.get(`${BASE_URL}/api/v2/theme/branding`, () => json({ server_name: 'S' })),
    );
    renderApp(<AppRoot launch={{}} registry={registry} storage={storage} device={testDevice} />);
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
  });

  it('starts at the profile list with a session without a profile', async () => {
    saveSignedIn();
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
    renderApp(<AppRoot launch={{}} registry={registry} storage={storage} device={testDevice} />);
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
  });

  it('starts at Home when the last profile reopens automatically', async () => {
    saveSignedIn('p1');
    const prefs = new ProfileLaunchPrefs(storage);
    prefs.setMode(BASE_URL, 'automatic');
    prefs.recordPick(BASE_URL, { id: 'p1', has_pin: false });
    server.use(
      http.get(`${BASE_URL}/api/v2/profiles`, () =>
        json(profileCollection([profile({ id: 'p1' })])),
      ),
      http.get(`${BASE_URL}/api/v2/home/capabilities`, () => json(homeCapabilities())),
      http.get(`${BASE_URL}/api/v2/home/sections`, () => json({ sections: [] })),
    );
    renderApp(<AppRoot launch={{}} registry={registry} storage={storage} device={testDevice} />);
    expect(await screen.findByText('Nothing to watch yet')).toBeInTheDocument();
  });
});
