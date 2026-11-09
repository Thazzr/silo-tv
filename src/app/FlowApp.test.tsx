import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { BASE_URL, account, problemResponse, systemInfo } from '../test/apiFixtures';
import {
  authProviders,
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
import { ServerRegistry } from './servers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const OTHER = 'https://other.example.test';

let storage: KeyValueStore;
let registry: ServerRegistry;
let clock: number;
beforeEach(() => {
  storage = memoryStorage();
  // A manual clock: each use of a server is later than the one before.
  clock = 1000;
  registry = new ServerRegistry(storage, () => (clock += 1000));
  clearInstallationCache();
});

/** Saves a server (it becomes the current one) and signs in to it, with a profile when given. */
function signedIn(origin = BASE_URL, profileId?: string): Session {
  registry.add(origin);
  const session = registry.session(origin);
  session.set({
    accessToken: origin === BASE_URL ? 'a' : 'token-other',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    ...(profileId ? { profileId } : {}),
  });
  return session;
}

function flow(launchServer = '') {
  return renderApp(
    <FlowApp
      launch={{ probe: false, transport: null, server: launchServer }}
      registry={registry}
      device={testDevice}
      storage={storage}
    />,
  );
}

/** The list row of a server, the button that opens it. */
const serverRow = (origin: string) =>
  document.querySelector<HTMLElement>(`[data-focus-key="server-${origin}"]`)!;

/** A single saved server without a session: the app opens on its sign-in screen. */
async function openSignIn(origin = BASE_URL) {
  registry.add(origin);
  const view = flow();
  await screen.findByTestId('signin-screen');
  return view;
}

/** What one server answers; the catalog and logout calls are recorded with the token they carried. */
interface Seen {
  catalog: (string | null)[];
  logout: (string | null)[];
}

function serveData(
  origin = BASE_URL,
  items = [profile({ id: 'p1' })],
  options: { name?: string; password?: boolean } = {},
): Seen {
  const seen: Seen = { catalog: [], logout: [] };
  server.use(
    http.get(`${origin}/api/v2/profiles`, () => HttpResponse.json(profileCollection(items))),
    http.get(`${origin}/api/v2/user/libraries`, () => HttpResponse.json({ items: [library()] })),
    http.get(`${origin}/api/v2/catalog`, ({ request }) => {
      seen.catalog.push(request.headers.get('Authorization'));
      return HttpResponse.json(catalogPage([catalogItem({ title: `Title of ${origin}` })]));
    }),
    http.get(`${origin}/api/v2/auth/device/capability`, () =>
      HttpResponse.json({ ...capability, state: 'disabled' }),
    ),
    http.get(`${origin}/api/v2/auth/providers`, () =>
      HttpResponse.json(authProviders([], options.password ?? false)),
    ),
    http.get(`${origin}/api/v2/theme/branding`, () =>
      HttpResponse.json(
        branding(options.name ? { server_name: options.name } : { server_name: 'Test Server' }),
      ),
    ),
    http.post(`${origin}/api/v2/auth/logout`, ({ request }) => {
      seen.logout.push(request.headers.get('Authorization'));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return seen;
}

describe('FlowApp', () => {
  it('runs server, sign-in, profile and library in order and saves the server', async () => {
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
    flow(BASE_URL);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('user-code')).toHaveTextContent('4821 7730');
    expect(registry.get(BASE_URL)).not.toBeNull();
    // Approved on the second poll; the single profile is selected without a question.
    expect(
      await screen.findByRole('button', { name: /Title of/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(registry.session(BASE_URL).get()).toMatchObject({
      accessToken: 'access-token-1',
      profileId: 'p1',
    });
    expect(polls).toBe(2);
  });

  it('"Switch profile" in the avatar menu shows the profile list even for a single profile', async () => {
    serveData();
    const session = signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()?.profileId).toBeUndefined();
    // Choosing it again returns to the shell, on Home.
    fireEvent.click(screen.getByRole('button', { name: /Alex/ }));
    expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('Back on the profile list (the root) asks to exit; Sign out ends the session and returns to sign-in', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    const session = signedIn();
    flow();
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
    serveData();
    const session = signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    act(() => session.signOut());
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
  });

  it('"Sign out" in the avatar menu returns to the sign-in of that server', async () => {
    const seen = serveData();
    const session = signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(session.get()).toBeNull();
    expect(seen.logout).toEqual(['Bearer a']);
    // The server stays in the list.
    expect(registry.get(BASE_URL)).not.toBeNull();
  });

  it('keeps the session when the user connects to the same server again', async () => {
    server.use(http.get(`${BASE_URL}/api/v2/system/info`, () => HttpResponse.json(systemInfo)));
    serveData();
    const session = signedIn(BASE_URL, 'p1');
    flow(BASE_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
    expect(session.get()).not.toBeNull();
    expect(registry.list()).toHaveLength(1);
  });

  it('does not save the server when its check fails', async () => {
    server.use(http.get(`${BASE_URL}/api/v2/system/info`, () => HttpResponse.error()));
    flow(BASE_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('server-error')).toBeInTheDocument();
    expect(registry.list()).toEqual([]);
  });

  it('sends the selected profile id on the catalog request', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    const ids: (string | null)[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog`, ({ request }) => {
        ids.push(request.headers.get('X-Profile-Id'));
        return HttpResponse.json(catalogPage([catalogItem({ title: 'First Title' })]));
      }),
    );
    signedIn();
    flow();
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
    flow(BASE_URL);
    await screen.findByTestId('server-screen');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByRole('dialog')).toHaveTextContent('Exit the app?');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('server-screen')).toBeInTheDocument();
  });

  it('Back from the sign-in after a sign-out leads to the server list, then asks to exit', async () => {
    serveData();
    const session = signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    act(() => session.signOut());
    await screen.findByTestId('signin-unavailable');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('server-list')).toBeInTheDocument();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
  });

  it('opens the player over the shell, and Back returns to the title that was played', async () => {
    const items = [
      catalogItem({ content_id: 'm1', title: 'First Title' }),
      catalogItem({ content_id: 'm2', title: 'Second Title' }),
      catalogItem({ content_id: 'm3', title: 'Third Title' }),
    ];
    serveData();
    server.use(http.get(`${BASE_URL}/api/v2/catalog`, () => HttpResponse.json(catalogPage(items))));
    const calls = servePlayback(server);
    signedIn(BASE_URL, 'p1');
    flow();
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
    serveData();
    const session = signedIn(BASE_URL, 'p1');
    // Default cache times: inactive queries would otherwise be dropped by the test client itself.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider lang="en">
          <FlowApp
            launch={{ probe: false, transport: null, server: '' }}
            registry={registry}
            device={testDevice}
            storage={storage}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: /Title of/ });
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

describe('FlowApp launch', () => {
  it('opens the add-server screen when no server is saved', async () => {
    flow();
    expect(await screen.findByTestId('server-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('server-list')).not.toBeInTheDocument();
  });

  it('goes straight on when exactly one server is saved and it has a session', async () => {
    serveData();
    signedIn(BASE_URL, 'p1');
    flow();
    expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
    expect(screen.queryByTestId('server-list')).not.toBeInTheDocument();
  });

  it('opens the profile step for a single server whose session has no profile yet', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    signedIn();
    flow();
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
  });

  it('opens the sign-in of a single saved server that has no session, and Back leads to the list', async () => {
    serveData();
    registry.add(BASE_URL);
    flow();
    expect(await screen.findByTestId('signin-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('server-list')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('server-list')).toBeInTheDocument();
  });

  it('shows the server list when several servers are saved and none has a session', async () => {
    serveData();
    serveData(OTHER, [profile({ id: 'p9' })], { name: 'Other Server' });
    registry.add(BASE_URL);
    registry.add(OTHER);
    flow();
    expect(await screen.findByTestId('server-list')).toBeInTheDocument();
    expect(screen.queryByTestId('signin-screen')).not.toBeInTheDocument();
  });

  it('shows the server list when several servers are saved, even when all have a session', async () => {
    serveData();
    serveData(OTHER, [profile({ id: 'p9' })], { name: 'Other Server' });
    signedIn(BASE_URL, 'p1');
    signedIn(OTHER, 'p9');
    flow();
    expect(await screen.findByTestId('server-list')).toBeInTheDocument();
    // The server used last is current: first, and focused.
    await waitFor(() => expect(serverRow(OTHER)).toHaveFocus());
    const rows = screen.getByTestId('server-list').querySelectorAll('.server-row .server-name');
    expect(rows).toHaveLength(2);
  });

  it('shows the add-server screen first when a server is given at launch, even with a saved one', async () => {
    signedIn(BASE_URL, 'p1');
    flow('other.example.test');
    expect(await screen.findByLabelText('Server address')).toHaveValue('other.example.test');
  });

  it('does not show the branding of a saved server on the add-server screen', async () => {
    serveData();
    signedIn(BASE_URL, 'p1');
    flow('other.example.test');
    await screen.findByTestId('server-screen');
    expect(screen.queryByTestId('brand-header')).not.toBeInTheDocument();
  });
});

describe('FlowApp several servers', () => {
  it('"Switch server" in the avatar menu opens the server list and keeps the session; Back returns', async () => {
    serveData();
    const session = signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch server' }));
    expect(await screen.findByTestId('server-list')).toBeInTheDocument();
    await waitFor(() => expect(serverRow(BASE_URL)).toHaveFocus());
    expect(session.get()).not.toBeNull();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
    expect(session.get()?.profileId).toBe('p1');
  });

  it('adds a second server from the list: its own sign-in, and both stay in the list', async () => {
    serveData();
    serveData(OTHER, [profile({ id: 'p9' })], { name: 'Other Server' });
    server.use(http.get(`${OTHER}/api/v2/system/info`, () => HttpResponse.json(systemInfo)));
    signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    const input = await screen.findByLabelText('Server address');
    // The list's own address is not pre-filled: this is a new server.
    expect(input).toHaveValue('');
    await userEvent.type(input, OTHER);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    // No session for it yet: its sign-in, not the first server's shell.
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(registry.list().map((s) => s.origin)).toEqual([OTHER, BASE_URL]);
    expect(registry.current()?.origin).toBe(OTHER);
    expect(registry.hasSession(BASE_URL)).toBe(true);
    expect(registry.hasSession(OTHER)).toBe(false);
    // Back steps through the add screen to the list, which shows both.
    fireEvent.keyDown(window, { keyCode: 461 });
    await screen.findByTestId('server-screen');
    fireEvent.keyDown(window, { keyCode: 461 });
    await screen.findByTestId('server-list');
    expect(screen.getByTestId('server-list').querySelectorAll('.server-row')).toHaveLength(2);
  });

  it('keeps one session per server: choosing, signing out of one and coming back', async () => {
    const seenA = serveData(BASE_URL, [profile({ id: 'p1' })], { name: 'Alpha' });
    const seenB = serveData(OTHER, [profile({ id: 'p9' })], { name: 'Bravo' });
    const sessionA = signedIn(BASE_URL, 'p1');
    const sessionB = signedIn(OTHER, 'p9');
    flow();
    // Both servers are saved, so the list opens; the later one (B) is current.
    await waitFor(() => expect(serverRow(OTHER)).toHaveFocus());

    // OK on A (which has a session) goes on without a sign-in, with A's token.
    fireEvent.click(serverRow(BASE_URL));
    expect(
      await screen.findByRole('button', { name: new RegExp(`Title of ${BASE_URL}`) }),
    ).toBeInTheDocument();
    expect(seenA.catalog).toEqual(['Bearer a']);
    expect(registry.current()?.origin).toBe(BASE_URL);

    // Sign out of A through the avatar menu: only A's session goes.
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(sessionA.get()).toBeNull();
    expect(sessionB.get()).not.toBeNull();
    expect(seenA.logout).toEqual(['Bearer a']);
    expect(seenB.logout).toEqual([]);
    expect(registry.hasSession(OTHER)).toBe(true);

    // Back to the list, then B: straight in with B's token, no sign-in.
    fireEvent.keyDown(window, { keyCode: 461 });
    await screen.findByTestId('server-list');
    fireEvent.click(serverRow(OTHER));
    expect(
      await screen.findByRole('button', { name: new RegExp(`Title of ${OTHER}`) }),
    ).toBeInTheDocument();
    expect(seenB.catalog).toEqual(['Bearer token-other']);
    // And A asks for a sign-in again.
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch server' }));
    fireEvent.click(await screen.findByTestId('server-list').then(() => serverRow(BASE_URL)));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
  });

  it('OK on a server without a session opens its sign-in', async () => {
    serveData();
    serveData(OTHER, [profile({ id: 'p9' })], { name: 'Other Server' });
    signedIn(BASE_URL, 'p1');
    registry.add(OTHER);
    flow();
    await screen.findByTestId('server-list');
    fireEvent.click(serverRow(OTHER));
    expect(await screen.findByTestId('signin-unavailable')).toBeInTheDocument();
    expect(registry.current()?.origin).toBe(OTHER);
  });

  it('removing the active server returns to the list with the other server, not to the removed one', async () => {
    serveData();
    serveData(OTHER, [profile({ id: 'p9' })], { name: 'Other Server' });
    signedIn(BASE_URL, 'p1');
    signedIn(OTHER, 'p9');
    flow();
    await screen.findByTestId('server-list');
    fireEvent.click(serverRow(BASE_URL));
    await screen.findByRole('button', { name: new RegExp(`Title of ${BASE_URL}`) });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch server' }));
    await screen.findByTestId('server-list');
    fireEvent.click(await screen.findByRole('button', { name: /^Remove Test Server/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(screen.queryByTestId('remove-server-dialog')).not.toBeInTheDocument(),
    );
    expect(registry.get(BASE_URL)).toBeNull();
    expect(registry.hasSession(BASE_URL)).toBe(false);
    expect(registry.hasSession(OTHER)).toBe(true);
    expect(screen.getByTestId('server-list').querySelectorAll('.server-row')).toHaveLength(1);
    // The list is the root now: Back asks to exit instead of returning to the removed server.
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Title of/ })).not.toBeInTheDocument();
  });

  it('removing the last server leads to the add-server screen', async () => {
    serveData();
    registry.add(BASE_URL);
    flow();
    // A single server without a session opens on its sign-in; Back leads to the list.
    await screen.findByTestId('signin-screen');
    fireEvent.keyDown(window, { keyCode: 461 });
    await screen.findByTestId('server-list');
    fireEvent.click(await screen.findByRole('button', { name: /^Remove/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByTestId('server-screen')).toBeInTheDocument();
    expect(registry.list()).toEqual([]);
  });
});

describe('FlowApp password sign-in', () => {
  it('signs in with a password from the sign-in screen and lands in the app for this server', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' })], { password: true });
    const logins: unknown[] = [];
    server.use(
      http.post(`${BASE_URL}/api/v2/auth/login`, async ({ request }) => {
        logins.push(await request.json());
        return HttpResponse.json(tokenPair);
      }),
    );
    await openSignIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with password' }));
    await userEvent.type(await screen.findByLabelText('Username'), 'test-viewer');
    await userEvent.type(screen.getByLabelText('Password'), 'fake-password-0000');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
    expect(logins).toEqual([{ username: 'test-viewer', password: 'fake-password-0000' }]);
    expect(registry.session(BASE_URL).get()).toMatchObject({ accessToken: 'access-token-1' });
    // The tokens live under this server's own key.
    expect(storage.get(`silo-tv.session.v1.${BASE_URL}`)).toContain('access-token-1');
    expect(storage.get('silo-tv.session.v1')).toBeNull();
  });

  it('Back from the password screen returns to the code screen, which starts a fresh code', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' })], { password: true });
    const starts: unknown[] = [];
    const cancels: unknown[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/auth/device/capability`, () => HttpResponse.json(capability)),
      http.post(`${BASE_URL}/api/v2/auth/device/start`, async ({ request }) => {
        starts.push(await request.json());
        return HttpResponse.json(deviceStart({ device_code: `code-${starts.length}` }), {
          status: 201,
        });
      }),
      http.post(`${BASE_URL}/api/v2/auth/device/cancel`, async ({ request }) => {
        cancels.push(await request.json());
        return HttpResponse.json({ status: 'canceled' });
      }),
    );
    await openSignIn();
    await screen.findByTestId('user-code');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with password' }));
    await screen.findByTestId('password-screen');
    // The first code was withdrawn when the user left for the password screen.
    await waitFor(() => expect(cancels).toEqual([{ device_code: 'code-1' }]));
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('user-code')).toBeInTheDocument();
    expect(starts).toHaveLength(2);
  });

  it('shows the wrong-password message and keeps the user on the password screen', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' })], { password: true });
    server.use(
      http.post(`${BASE_URL}/api/v2/auth/login`, () => problemResponse('invalid_credentials', 401)),
    );
    await openSignIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with password' }));
    await userEvent.type(await screen.findByLabelText('Username'), 'test-viewer');
    await userEvent.type(screen.getByLabelText('Password'), 'fake-password-0000');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('password-error')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(registry.hasSession(BASE_URL)).toBe(false);
  });
});

describe('FlowApp branding', () => {
  const rootStyle = () => document.documentElement.style.getPropertyValue('--accent');

  function serveBranding(doc: ReturnType<typeof branding>) {
    server.use(http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.json(doc)));
  }

  it('the sign-in screen shows the wordmark, the subtitle and the darkened background', async () => {
    serveData();
    serveBranding(
      branding({
        server_name: 'Movie Barn',
        login_subtitle: 'Welcome back',
        wordmark_url: '/api/v2/branding/assets/wordmark?v=2',
        login_bg_url: '/api/v2/branding/assets/login_bg?v=3',
      }),
    );
    await openSignIn();
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

  it('falls back to the server name without a wordmark, and to the host without branding', async () => {
    serveData();
    serveBranding(branding({ server_name: 'Movie Barn' }));
    const first = await openSignIn();
    await waitFor(() => expect(screen.getByTestId('brand-name')).toHaveTextContent('Movie Barn'));
    expect(screen.queryByTestId('wordmark')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brand-backdrop')).not.toBeInTheDocument();
    first.unmount();

    server.use(http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.error()));
    flow();
    await screen.findByTestId('signin-unavailable');
    expect(screen.getByTestId('brand-name')).toHaveTextContent('silo.example.test');
  });

  it('shows the plain name when the wordmark or the background cannot be loaded', async () => {
    serveData();
    serveBranding(
      branding({ server_name: 'Movie Barn', wordmark_url: '/w.png', login_bg_url: '/bg.png' }),
    );
    await openSignIn();
    fireEvent.error(await screen.findByTestId('wordmark'));
    expect(screen.getByTestId('brand-name')).toHaveTextContent('Movie Barn');
    fireEvent.error(screen.getByTestId('brand-backdrop').querySelector('img')!);
    expect(screen.queryByTestId('brand-backdrop')).not.toBeInTheDocument();
  });

  it('applies a light accent as --accent, also on the screens after a sign-out', async () => {
    serveData();
    serveBranding(branding({ accent_color: '#e5a00d' }));
    const session = signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    await waitFor(() => expect(rootStyle()).toBe('#e5a00d'));
    act(() => session.signOut());
    await screen.findByTestId('signin-unavailable');
    // Signed out: the branding is fetched again for the sign-in screen and applied there too.
    await waitFor(() => expect(rootStyle()).toBe('#e5a00d'));
  });

  it('ignores an accent that is too dark for the black page', async () => {
    serveData();
    serveBranding(branding({ accent_color: '#1a2b6d' }));
    signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    await waitFor(() => expect(screen.getByTestId('server-name')).toHaveTextContent('Test Server'));
    expect(rootStyle()).toBe('');
  });
});
