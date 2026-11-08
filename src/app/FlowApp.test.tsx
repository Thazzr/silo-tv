import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../api/session';
import { BASE_URL, account, systemInfo } from '../test/apiFixtures';
import {
  capability,
  catalogItem,
  catalogPage,
  deviceStart,
  devicePoll,
  library,
  profile,
  profileCollection,
  tokenPair,
} from '../test/flowFixtures';
import { I18nProvider } from '../i18n';
import { memoryStorage, renderApp, testDevice } from '../test/renderFlow';
import { FlowApp } from './FlowApp';
import { loadServer, saveServer } from './serverStore';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

const OTHER = 'https://other.example.test';

function sessionWith(profileId?: string) {
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

function flow(session: Session, launchServer = '') {
  return renderApp(
    <FlowApp
      launch={{ probe: false, transport: null, server: launchServer }}
      session={session}
      device={testDevice}
      storage={storage}
    />,
  );
}

function serveData(items = [profile({ id: 'p1' })]) {
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () => HttpResponse.json(profileCollection(items))),
    http.get(`${BASE_URL}/api/v2/user/libraries`, () => HttpResponse.json({ items: [library()] })),
    http.get(`${BASE_URL}/api/v2/catalog`, () =>
      HttpResponse.json(catalogPage([catalogItem({ title: 'First Title' })])),
    ),
    http.get(`${BASE_URL}/api/v2/auth/device/capability`, () =>
      HttpResponse.json({ ...capability, state: 'disabled' }),
    ),
    http.post(`${BASE_URL}/api/v2/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  );
}

describe('FlowApp', () => {
  it('runs server, sign-in, profile and library in order and stores the server', async () => {
    let polls = 0;
    // Handlers added later win, so the generic data comes first.
    serveData();
    server.use(
      http.get(`${BASE_URL}/api/v2/system/info`, () => HttpResponse.json(systemInfo)),
      http.get(`${BASE_URL}/api/v2/auth/device/capability`, () => HttpResponse.json(capability)),
      http.post(`${BASE_URL}/api/v2/auth/device/start`, () =>
        HttpResponse.json(deviceStart({ interval: 1 }), { status: 201 }),
      ),
      http.post(`${BASE_URL}/api/v2/auth/device/poll`, () => {
        polls += 1;
        return HttpResponse.json(
          polls < 2
            ? devicePoll({ poll_after: 1 })
            : devicePoll({ status: 'approved', tokens: tokenPair }),
        );
      }),
    );
    const session = new Session(memoryStorage());
    flow(session, BASE_URL);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('user-code')).toHaveTextContent('4821 7730');
    expect(loadServer(storage)).toBe(BASE_URL);
    // Approved on the second poll; the single profile is selected without a question.
    expect(
      await screen.findByRole('button', { name: /First Title/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(session.get()).toMatchObject({ accessToken: 'access-token-1', profileId: 'p1' });
    expect(polls).toBe(2);
  });

  it('Back from the library shows the profile list even for a single profile', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()?.profileId).toBeUndefined();
    // Choosing it again returns to the library.
    fireEvent.click(screen.getByRole('button', { name: /Alex/ }));
    expect(await screen.findByRole('button', { name: /First Title/ })).toBeInTheDocument();
  });

  it('Back on the profile list does nothing; Sign out ends the session and returns to sign-in', async () => {
    saveServer(BASE_URL, storage);
    serveData([profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    const session = sessionWith();
    flow(session);
    await screen.findByTestId('profile-list');
    fireEvent.keyDown(window, { keyCode: 461 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(session.get()).toBeNull();
  });

  it('returns to sign-in when the session ends elsewhere (refused refresh, sign out)', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    act(() => session.signOut());
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
  });

  it('the sign-out button on the library returns to sign-in', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(session.get()).toBeNull();
  });

  it('drops the session when the user connects to a different server', async () => {
    saveServer(BASE_URL, storage);
    server.use(
      http.get(`${OTHER}/api/v2/system/info`, () => HttpResponse.json(systemInfo)),
      http.get(`${OTHER}/api/v2/auth/device/capability`, () =>
        HttpResponse.json({ ...capability, state: 'disabled' }),
      ),
    );
    const session = sessionWith('p1');
    flow(session, OTHER);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(session.get()).toBeNull();
    expect(loadServer(storage)).toBe(OTHER);
  });

  it('keeps the session when the user connects to the same server again', async () => {
    saveServer(BASE_URL, storage);
    server.use(http.get(`${BASE_URL}/api/v2/system/info`, () => HttpResponse.json(systemInfo)));
    serveData();
    const session = sessionWith('p1');
    flow(session, BASE_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('button', { name: /First Title/ })).toBeInTheDocument();
    expect(session.get()).not.toBeNull();
  });

  it('"Change server" on the sign-in screen goes back to the server screen', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    flow(new Session(memoryStorage()));
    await screen.findByTestId('signin-unavailable');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('server-screen')).toBeInTheDocument();
    expect(screen.getByLabelText('Server address')).toHaveValue(BASE_URL);
  });

  it('does not store the server when its check fails', async () => {
    server.use(http.get(`${BASE_URL}/api/v2/system/info`, () => HttpResponse.error()));
    flow(new Session(memoryStorage()), BASE_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('server-error')).toBeInTheDocument();
    expect(loadServer(storage)).toBeNull();
  });

  it('sends the selected profile id on the catalog request', async () => {
    saveServer(BASE_URL, storage);
    serveData([profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    const ids: (string | null)[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog`, ({ request }) => {
        ids.push(request.headers.get('X-Profile-Id'));
        return HttpResponse.json(catalogPage([catalogItem({ title: 'First Title' })]));
      }),
    );
    flow(sessionWith());
    fireEvent.click(await screen.findByRole('button', { name: /Sam/ }));
    await screen.findByRole('button', { name: /First Title/ });
    expect(ids).toEqual(['p2']);
    // Another profile after Back: the new request carries the new id, not a cached one.
    fireEvent.keyDown(window, { keyCode: 461 });
    fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
    await screen.findByRole('button', { name: /First Title/ });
    expect(ids).toEqual(['p2', 'p1']);
  });

  it('empties the profile, library and catalog caches when the session ends', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    // Default cache times: inactive queries would otherwise be dropped by the test client itself.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider lang="en">
          <FlowApp
            launch={{ probe: false, transport: null, server: '' }}
            session={session}
            device={testDevice}
            storage={storage}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: /First Title/ });
    const userData = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => ['profiles', 'libraries', 'catalog'].includes(String(q.queryKey[0])));
    expect(userData().length).toBeGreaterThan(0);
    act(() => session.signOut());
    await screen.findByTestId('signin-unavailable');
    expect(userData()).toHaveLength(0);
  });
});
