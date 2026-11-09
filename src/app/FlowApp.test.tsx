import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { BASE_URL, account, systemInfo } from '../test/apiFixtures';
import {
  branding,
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
import { clearInstallationCache } from '../playback/usePlaybackSession';
import { servePlayback } from '../test/playbackFixtures';
import { KEY, pressKey } from '../test/keys';
import { memoryStorage, renderApp, testDevice } from '../test/renderFlow';
import { FlowApp } from './FlowApp';
import { loadServer, saveServer } from './serverStore';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let storage: KeyValueStore;
beforeEach(() => {
  storage = memoryStorage();
  clearInstallationCache();
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
    http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.json(branding())),
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

  it('"Switch profile" in the avatar menu shows the profile list even for a single profile', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()?.profileId).toBeUndefined();
    // Choosing it again returns to the shell, on Home.
    fireEvent.click(screen.getByRole('button', { name: /Alex/ }));
    expect(await screen.findByRole('button', { name: /First Title/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('Back on the profile list (the root) asks to exit; Sign out ends the session and returns to sign-in', async () => {
    saveServer(BASE_URL, storage);
    serveData([profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    const session = sessionWith();
    flow(session);
    await screen.findByTestId('profile-list');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()).not.toBeNull();
    fireEvent.keyDown(window, { keyCode: 461 });
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
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

  it('"Sign out" in the avatar menu returns to sign-in', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
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
    // Another profile after switching: the new request carries the new id, not a cached one.
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
    await screen.findByRole('button', { name: /First Title/ });
    expect(ids).toEqual(['p2', 'p1']);
  });

  it('Back on the server screen (the root) opens the exit popup; Cancel closes it', async () => {
    flow(new Session(memoryStorage()), BASE_URL);
    await screen.findByTestId('server-screen');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByRole('dialog')).toHaveTextContent('Exit the app?');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('server-screen')).toBeInTheDocument();
  });

  it('Back from the sign-in screen after a sign-out leads to the server screen, then asks to exit', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    act(() => session.signOut());
    await screen.findByTestId('signin-unavailable');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('server-screen')).toBeInTheDocument();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
  });

  it('opens the player over the shell, and Back returns to the title that was played', async () => {
    saveServer(BASE_URL, storage);
    const items = [
      catalogItem({ content_id: 'm1', title: 'First Title' }),
      catalogItem({ content_id: 'm2', title: 'Second Title' }),
      catalogItem({ content_id: 'm3', title: 'Third Title' }),
    ];
    serveData();
    server.use(http.get(`${BASE_URL}/api/v2/catalog`, () => HttpResponse.json(catalogPage(items))));
    const calls = servePlayback(server);
    flow(sessionWith('p1'));
    // The shell opens on the Home tab; Down enters the list.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus());
    await screen.findByTestId('title-list');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Third Title/ })).toHaveFocus();
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('player')).toBeInTheDocument();
    expect(screen.queryByTestId('title-list')).not.toBeInTheDocument();
    expect(calls.start).toHaveLength(1);
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('title-list')).toBeInTheDocument();
    // Back lands on the title that was played, not on the first one.
    await waitFor(() => expect(screen.getByRole('button', { name: /Third Title/ })).toHaveFocus());
    await waitFor(() => expect(calls.stop).toHaveLength(1));
    // Back in the list goes to the tab bar, and Back on Home's tab asks to exit.
    fireEvent.keyDown(window, { keyCode: 461 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus());
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
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

  it('"Switch server" in the avatar menu opens the server screen and keeps the session; Back returns', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch server' }));
    expect(await screen.findByTestId('server-screen')).toBeInTheDocument();
    expect(screen.getByLabelText('Server address')).toHaveValue(BASE_URL);
    expect(session.get()).not.toBeNull();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByRole('button', { name: /First Title/ })).toBeInTheDocument();
    expect(session.get()?.profileId).toBe('p1');
  });
});

describe('FlowApp branding', () => {
  const rootStyle = () => document.documentElement.style.getPropertyValue('--accent');

  function serveBranding(doc: ReturnType<typeof branding>) {
    server.use(http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.json(doc)));
  }

  it('the sign-in screen shows the wordmark, the subtitle and the darkened background', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    serveBranding(
      branding({
        server_name: 'Movie Barn',
        login_subtitle: 'Welcome back',
        wordmark_url: '/api/v2/branding/assets/wordmark?v=2',
        login_bg_url: '/api/v2/branding/assets/login_bg?v=3',
      }),
    );
    flow(new Session(memoryStorage()));
    await screen.findByTestId('signin-unavailable');
    expect(await screen.findByTestId('wordmark')).toHaveAttribute(
      'src',
      `${BASE_URL}/api/v2/branding/assets/wordmark?v=2`,
    );
    expect(screen.getByTestId('wordmark')).toHaveAttribute('alt', 'Movie Barn');
    expect(screen.getByTestId('brand-subtitle')).toHaveTextContent('Welcome back');
    const backdrop = screen.getByTestId('brand-backdrop');
    expect(backdrop.querySelector('img')).toHaveAttribute(
      'src',
      `${BASE_URL}/api/v2/branding/assets/login_bg?v=3`,
    );
    // The shade over the picture is what keeps the text readable.
    expect(backdrop.querySelector('.brand-backdrop-shade')).toBeInTheDocument();
  });

  it('the server screen shows the wordmark of the stored server', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    serveBranding(branding({ wordmark_url: '/w.png' }));
    flow(sessionWith('p1'), BASE_URL);
    expect(await screen.findByTestId('wordmark')).toHaveAttribute('src', `${BASE_URL}/w.png`);
    expect(screen.getByTestId('server-screen')).toBeInTheDocument();
    // The subtitle belongs to the sign-in screen only.
    expect(screen.queryByTestId('brand-subtitle')).not.toBeInTheDocument();
  });

  it('falls back to the server name without a wordmark, and to the host without branding', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    serveBranding(branding({ server_name: 'Movie Barn' }));
    const first = flow(new Session(memoryStorage()));
    await screen.findByTestId('signin-unavailable');
    await waitFor(() => expect(screen.getByTestId('brand-name')).toHaveTextContent('Movie Barn'));
    expect(screen.queryByTestId('wordmark')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brand-backdrop')).not.toBeInTheDocument();
    first.unmount();

    server.use(http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.error()));
    flow(new Session(memoryStorage()));
    await screen.findByTestId('signin-unavailable');
    expect(screen.getByTestId('brand-name')).toHaveTextContent('silo.example.test');
  });

  it('shows the plain name when the wordmark or the background cannot be loaded', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    serveBranding(
      branding({ server_name: 'Movie Barn', wordmark_url: '/w.png', login_bg_url: '/bg.png' }),
    );
    flow(new Session(memoryStorage()));
    fireEvent.error(await screen.findByTestId('wordmark'));
    expect(screen.getByTestId('brand-name')).toHaveTextContent('Movie Barn');
    fireEvent.error(screen.getByTestId('brand-backdrop').querySelector('img')!);
    expect(screen.queryByTestId('brand-backdrop')).not.toBeInTheDocument();
  });

  it('applies a light accent as --accent, also on the screens after a sign-out', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    serveBranding(branding({ accent_color: '#e5a00d' }));
    const session = sessionWith('p1');
    flow(session);
    await screen.findByRole('button', { name: /First Title/ });
    await waitFor(() => expect(rootStyle()).toBe('#e5a00d'));
    act(() => session.signOut());
    await screen.findByTestId('signin-unavailable');
    // Signed out: the branding is fetched again for the sign-in screen and applied there too.
    await waitFor(() => expect(rootStyle()).toBe('#e5a00d'));
  });

  it('ignores an accent that is too dark for the black page', async () => {
    saveServer(BASE_URL, storage);
    serveData();
    serveBranding(branding({ accent_color: '#1a2b6d' }));
    flow(sessionWith('p1'));
    await screen.findByRole('button', { name: /First Title/ });
    await waitFor(() => expect(screen.getByTestId('server-name')).toHaveTextContent('Test Server'));
    expect(rootStyle()).toBe('');
  });
});
