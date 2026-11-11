import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { BASE_URL, account, problem, problemResponse, systemInfo } from '../test/apiFixtures';
import {
  authProviders,
  branding,
  capability,
  catalogItem,
  deviceStart,
  devicePoll,
  library,
  profile,
  profileCollection,
  tokenPair,
} from '../test/flowFixtures';
import { I18nProvider } from '../i18n';
import { ProfileLaunchPrefs, type LaunchMode } from '../features/profiles/launchPrefs';
import { clearInstallationCache } from '../playback/session/startSession';
import { episodeOf, itemDetail, seasonOf, serveDetail } from '../test/detailFixtures';
import { homeCapabilities, homeSection, resumeEpisode } from '../test/homeFixtures';
import { installFakeMedia } from '../test/fakeVideo';
import {
  playableDecision,
  servePlayback,
  terminalDecision,
  watchDetail,
  watchUserData,
} from '../test/playbackFixtures';
import { serveSettings } from '../test/settingsFixtures';
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

/**
 * Saves a server (it becomes the current one) and signs in to it, with a profile when given. The
 * device setting is seeded so that a session with a profile reopens it (Automatic) and no
 * "Open automatically?" question comes up; the launch tests below seed their own.
 */
function signedIn(origin = BASE_URL, profileId?: string): Session {
  registry.add(origin);
  const prefs = new ProfileLaunchPrefs(storage);
  if (profileId) {
    prefs.setMode(origin, 'automatic');
    prefs.recordPick(origin, { id: profileId, has_pin: false });
  } else {
    prefs.markOffered(origin);
  }
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

function flow(launchServer = '', now?: () => number) {
  return renderApp(
    <FlowApp
      launch={{ probe: false, transport: null, server: launchServer }}
      registry={registry}
      device={testDevice}
      storage={storage}
      now={now}
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

/** What one server answers; the Home and logout calls are recorded with the token they carried. */
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
    http.get(`${origin}/api/v2/home/capabilities`, () => HttpResponse.json(homeCapabilities())),
    http.get(`${origin}/api/v2/home/sections`, ({ request }) => {
      seen.catalog.push(request.headers.get('Authorization'));
      return HttpResponse.json({
        sections: [
          homeSection('recent', 0, {
            items: [catalogItem({ title: `Title of ${origin}` })],
            total_count: 1,
          }),
        ],
      });
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
    fireEvent.click(
      within(await screen.findByTestId('signout-dialog')).getByRole('button', { name: 'Sign out' }),
    );
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
    fireEvent.click(
      within(await screen.findByTestId('signout-dialog')).getByRole('button', { name: 'Sign out' }),
    );
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

  it('sends the selected profile id on the Home request', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    const ids: (string | null)[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/home/sections`, ({ request }) => {
        ids.push(request.headers.get('X-Profile-Id'));
        return HttpResponse.json({
          sections: [
            homeSection('recent', 0, {
              items: [catalogItem({ title: 'First Title' })],
              total_count: 1,
            }),
          ],
        });
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

  it('opens the detail page and then the player over the shell, and Back returns step by step to the title', async () => {
    const items = [
      catalogItem({ content_id: 'm1', title: 'First Title' }),
      catalogItem({ content_id: 'm2', title: 'Second Title' }),
      catalogItem({ content_id: 'm3', title: 'Third Title' }),
    ];
    serveData();
    // One title per row, so Down walks the titles.
    server.use(
      http.get(`${BASE_URL}/api/v2/home/sections`, () =>
        HttpResponse.json({
          sections: items.map((item, i) =>
            homeSection(`r${i + 1}`, 0, { items: [item], total_count: 1 }),
          ),
        }),
      ),
    );
    const calls = servePlayback(server);
    serveDetail(server, {
      item: (id) => itemDetail({ content_id: id, title: `Detail of ${id}`, versions: [] }),
    });
    signedIn(BASE_URL, 'p1');
    flow();
    // The shell opens on the Home tab; Down enters the list.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus());
    await screen.findByTestId('row-r3');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Third Title/ })).toHaveFocus();
    // OK opens the title's page; Play on it opens the player.
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Detail of m3');
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    expect(calls.start).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus());
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('player')).toBeInTheDocument();
    await waitFor(() => expect(calls.start).toHaveLength(1));
    // The viewer chose on the detail page: the player does not ask again.
    expect(calls.start[0]?.body.start_position).toBe(0);
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('detail-title')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus());
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    // Back lands on the title that was played, not on the first one.
    await waitFor(() => expect(screen.getByRole('button', { name: /Third Title/ })).toHaveFocus());
    await waitFor(() => expect(calls.stop).toHaveLength(1));
    // Back in the list goes to the tab bar, and Back on Home's tab asks to exit.
    fireEvent.keyDown(window, { keyCode: 461 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus());
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
  });

  it('opens the series of an episode card on its season and episode, and plays a Continue Watching episode directly', async () => {
    serveData();
    const plain = catalogItem({
      content_id: 'e23',
      type: 'episode',
      title: 'Episode 2.3',
      series_title: 'A Show',
      series_id: 's1',
      season_number: 2,
      episode_number: 3,
    });
    server.use(
      http.get(`${BASE_URL}/api/v2/home/sections`, () =>
        HttpResponse.json({
          sections: [
            homeSection('cw', 0, {
              section_type: 'continue_watching',
              items: [resumeEpisode('e1')],
              total_count: 1,
            }),
            homeSection('added', 0, { items: [plain], total_count: 1 }),
          ],
        }),
      ),
    );
    const calls = servePlayback(server);
    serveDetail(server, {
      item: () => itemDetail({ content_id: 's1', type: 'series', title: 'A Show', versions: [] }),
      seasons: [seasonOf(1), seasonOf(2)],
      episodes: (season) => [1, 2, 3].map((n) => episodeOf(season, n)),
    });
    signedIn(BASE_URL, 'p1');
    flow();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus());
    await screen.findByTestId('row-added');
    // The episode of Continue Watching plays right away (OK tapped: opens on release).
    await pressKey(KEY.down);
    fireEvent.keyDown(window, { keyCode: KEY.enter });
    fireEvent.keyUp(window, { keyCode: KEY.enter });
    expect(await screen.findByTestId('player')).toBeInTheDocument();
    await waitFor(() => expect(calls.capabilities).toBe(1));
    fireEvent.keyDown(window, { keyCode: 461 });
    await screen.findByTestId('home');
    await waitFor(() => expect(screen.getByRole('button', { name: /Show e1/ })).toHaveFocus());
    // Any other episode card opens the series on that season, focused on that episode.
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('A Show');
    await screen.findByTestId('episode-strip');
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="episode:e23"]')).toHaveFocus(),
    );
  });

  it('replaces the player with the next episode: the old session stops, the new one starts by the resume rule with no tracks, and Back goes where it would have', async () => {
    serveData();
    server.use(
      http.get(`${BASE_URL}/api/v2/home/sections`, () =>
        HttpResponse.json({
          sections: [
            homeSection('cw', 0, {
              section_type: 'continue_watching',
              items: [resumeEpisode('e1')],
              total_count: 1,
            }),
          ],
        }),
      ),
    );
    // The second start fails, so the new entry's own title shows on the error screen.
    const calls = servePlayback(server, {
      start: [playableDecision(), terminalDecision()],
    });
    // Every watch read answers an episode with a saved position: the resume rule applies.
    const watched: string[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/watch/:id`, ({ params }) => {
        watched.push(String(params.id));
        return HttpResponse.json(
          watchDetail({
            content_id: String(params.id),
            type: 'episode',
            series_id: 's1',
            series_title: 'A Show',
            season_number: 1,
            episode_number: 2,
            title: 'Episode 1.2',
            user_data: watchUserData({ position_seconds: 600, duration_seconds: 5400 }),
          }),
        );
      }),
    );
    const files = [{ file_id: 'f', hdr: false, file_size: 1 }];
    serveDetail(server, {
      seasons: [seasonOf(1)],
      episodes: () => [1, 2, 3].map((n) => episodeOf(1, n, { files })),
    });
    const restoreMedia = installFakeMedia();
    try {
      signedIn(BASE_URL, 'p1');
      flow();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus());
      await screen.findByTestId('row-cw');
      await pressKey(KEY.down);
      fireEvent.keyDown(window, { keyCode: KEY.enter });
      fireEvent.keyUp(window, { keyCode: KEY.enter });
      await screen.findByTestId('player');
      fireEvent.playing(document.querySelector('video')!);
      await waitFor(() => expect(watched).toEqual(['e1']));
      await waitFor(() =>
        expect(document.querySelector('[data-focus-key="nextEpisode"]')).not.toBeNull(),
      );
      // Up opens the overlay on the scrubber, Down moves to Play, Right twice to Next.
      fireEvent.keyDown(window, { keyCode: KEY.up });
      fireEvent.keyDown(window, { keyCode: KEY.down });
      fireEvent.keyDown(window, { keyCode: KEY.right });
      fireEvent.keyDown(window, { keyCode: KEY.right });
      fireEvent.keyDown(window, { keyCode: KEY.enter });
      // The neighbour is opened in this entry's place, by its id, with no prompt.
      await waitFor(() => expect(watched).toEqual(['e1', 'e13']));
      await waitFor(() => expect(calls.start).toHaveLength(2));
      expect(screen.queryByTestId('resume-prompt')).not.toBeInTheDocument();
      expect(calls.start[1]?.body.start_position).toBeGreaterThan(0);
      // No track is carried over: the server and the settings choose them.
      for (const field of [
        'audio_track_id',
        'audio_track_index',
        'subtitle_track_id',
        'subtitle_track_index',
      ]) {
        expect(calls.start[1]?.body).not.toHaveProperty(field);
      }
      // The first session was stopped, and only it so far.
      await waitFor(() => expect(calls.stop).toHaveLength(1));
      // The new entry carries the neighbour's title (the failed start names it).
      expect(await screen.findByRole('heading', { name: 'Episode 1.3' })).toBeInTheDocument();
      // The entry was replaced, not pushed: one Back from the new episode goes where Back from
      // the old one would have, to Home, not to the old episode.
      fireEvent.keyDown(window, { keyCode: 461 });
      expect(await screen.findByTestId('home')).toBeInTheDocument();
      expect(screen.queryByTestId('player')).not.toBeInTheDocument();
      expect(screen.queryByTestId('player-error')).not.toBeInTheDocument();
      expect(calls.start).toHaveLength(2);
    } finally {
      restoreMedia();
    }
  });

  it('drops the detail queries of the old profile when the profile is switched', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    serveDetail(server, { item: (id) => itemDetail({ content_id: id, versions: [] }) });
    signedIn(BASE_URL, 'p1');
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
    fireEvent.click(await screen.findByRole('button', { name: /Title of/ }));
    await screen.findByTestId('detail-hero');
    fireEvent.keyDown(window, { keyCode: 461 });
    await screen.findByTestId('home');
    const detailQueries = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'detail');
    expect(detailQueries().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(detailQueries()).toHaveLength(0);
  });

  it('drops the Home queries of the old profile when the profile is switched', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    signedIn(BASE_URL, 'p1');
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
    const homeQueries = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'home');
    expect(homeQueries().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(homeQueries()).toHaveLength(0);
  });

  it('drops the Movies and Series library queries of the old profile when the profile is switched', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    signedIn(BASE_URL, 'p1');
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
    // What the library tabs have read for this profile (sections, Browse pages, collections, ...)
    // is held under the 'library' key; the cache keeps it after the tab is left.
    queryClient.setQueryData(['library', 'sections', 'base', 'p1', 'lib-1', 20], []);
    queryClient.setQueryData(['library', 'collections', 'base', 'p1', 'lib-1'], {});
    const libraryQueries = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'library');
    expect(libraryQueries()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(libraryQueries()).toHaveLength(0);
  });

  it('opens the subtitle appearance dialog from Settings and Back returns to Settings', async () => {
    serveData();
    serveSettings(server);
    signedIn(BASE_URL, 'p1');
    flow();
    await screen.findByRole('button', { name: /Title of/ });
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: /Subtitle appearance/ }));
    expect(await screen.findByRole('dialog', { name: 'Subtitle appearance' })).toBeInTheDocument();
    // The dialog is over the Settings screen, not a screen of its own.
    expect(screen.getByTestId('settings-screen')).toBeInTheDocument();
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog')).toBeNull());
    expect(screen.getByTestId('settings-screen')).toBeInTheDocument();
  });

  it('drops the settings the old profile read when the profile is switched', async () => {
    serveData(BASE_URL, [profile({ id: 'p1' }), profile({ id: 'p2', name: 'Sam' })]);
    signedIn(BASE_URL, 'p1');
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
    queryClient.setQueryData(['settings', 'effective', BASE_URL, 'p1', 'ui.title_art'], {});
    const settingsQueries = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'settings');
    expect(settingsQueries().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(settingsQueries()).toHaveLength(0);
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
        .filter((q) =>
          ['profiles', 'libraries', 'catalog', 'home'].includes(String(q.queryKey[0])),
        );
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
    fireEvent.click(
      within(await screen.findByTestId('signout-dialog')).getByRole('button', { name: 'Sign out' }),
    );
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
    expect(storage.get(`silo-tv.session.v1.${BASE_URL}`)).toContain('refresh-token-1');
    expect(storage.get(`silo-tv.session.v1.${BASE_URL}`)).not.toContain('access-token-1');
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

describe('FlowApp profile at launch', () => {
  const T0 = 1_700_000_000_000;
  const HOUR = 3_600_000;
  const alex = profile({ id: 'p1', name: 'Alex' });
  const sam = profile({ id: 'p2', name: 'Sam', has_pin: true, is_primary: false });
  const mia = profile({ id: 'p3', name: 'Mia', is_child: true, is_primary: false });

  /** A TV that used p1 at T0 under a mode, with the session still holding that profile. */
  function usedAt(
    mode: LaunchMode,
    options: { profile?: { id: string; has_pin: boolean }; at?: number; token?: string } = {},
  ): Session {
    const picked = options.profile ?? { id: 'p1', has_pin: false };
    const session = signedIn(BASE_URL, picked.id);
    session.update({ profileToken: options.token });
    const prefs = new ProfileLaunchPrefs(storage, () => options.at ?? T0);
    prefs.setMode(BASE_URL, mode);
    prefs.recordPick(BASE_URL, picked);
    return session;
  }

  const stored = (origin = BASE_URL) => new ProfileLaunchPrefs(storage).get(origin);

  it('Automatic opens the last profile without the picker, however long ago', async () => {
    const seen = serveData(BASE_URL, [alex, sam]);
    const session = usedAt('automatic', { at: T0 - 400 * HOUR });
    flow('', () => T0);
    expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
    expect(screen.queryByTestId('profile-list')).not.toBeInTheDocument();
    expect(session.get()?.profileId).toBe('p1');
    expect(seen.catalog).toHaveLength(1);
  });

  it('Every time shows the picker even though the session holds a profile, and forgets it', async () => {
    serveData(BASE_URL, [alex, sam]);
    const session = usedAt('every', { token: 'pvt_old' });
    flow('', () => T0);
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()?.profileId).toBeUndefined();
    expect(session.get()?.profileToken).toBeUndefined();
    // The picker starts on the profile used last.
    await waitFor(() => expect(screen.getByRole('button', { name: /Alex/ })).toHaveFocus());
  });

  it('the picker starts on the remembered profile, not on the first one', async () => {
    serveData(BASE_URL, [alex, mia]);
    usedAt('every', { profile: { id: 'p3', has_pin: false } });
    flow('', () => T0);
    await screen.findByTestId('profile-list');
    await waitFor(() => expect(screen.getByRole('button', { name: /Mia/ })).toHaveFocus());
  });

  it.each([
    ['hour', HOUR],
    ['halfday', 12 * HOUR],
  ] as const)(
    '%s: reopens at exactly the limit and shows the picker just past it',
    async (mode, limit) => {
      serveData(BASE_URL, [alex, sam]);
      usedAt(mode);
      const first = flow('', () => T0 + limit);
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      first.unmount();

      const session = usedAt(mode);
      flow('', () => T0 + limit + 1);
      expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
      expect(session.get()?.profileId).toBeUndefined();
    },
  );

  describe('verifying the remembered profile before Automatic opens it', () => {
    it('opens it only after the list confirmed it', async () => {
      const seen = serveData(BASE_URL, [alex, sam]);
      const session = usedAt('automatic');
      flow('', () => T0);
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(session.get()?.profileId).toBe('p1');
      expect(seen.catalog).toHaveLength(1);
    });

    it('shows the picker when the remembered profile was deleted', async () => {
      const seen = serveData(BASE_URL, [sam, mia]);
      const session = usedAt('automatic');
      flow('', () => T0);
      expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
      expect(session.get()?.profileId).toBeUndefined();
      expect(seen.catalog).toHaveLength(0);
    });

    it('shows the picker when the remembered profile now has a PIN', async () => {
      const seen = serveData(BASE_URL, [{ ...alex, has_pin: true }, mia]);
      const session = usedAt('automatic');
      flow('', () => T0);
      expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
      expect(session.get()?.profileId).toBeUndefined();
      expect(seen.catalog).toHaveLength(0);
    });

    it('never opens silently when the list cannot be read: error with Try again, then opens', async () => {
      const seen = serveData(BASE_URL, [alex, sam]);
      server.use(
        http.get(
          `${BASE_URL}/api/v2/profiles`,
          () => HttpResponse.json(problem('internal', 500), { status: 500 }),
          {
            once: true,
          },
        ),
      );
      const session = usedAt('automatic');
      flow('', () => T0);
      expect(await screen.findByTestId('error-state')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Title of/ })).not.toBeInTheDocument();
      expect(session.get()?.profileId).toBeUndefined();
      expect(seen.catalog).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(session.get()?.profileId).toBe('p1');
    });
  });

  it('shows the picker when the clock reads earlier than the last use', async () => {
    serveData(BASE_URL, [alex, sam]);
    usedAt('hour');
    flow('', () => T0 - 1);
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
  });

  it.each(['automatic', 'hour', 'halfday'] as const)(
    'never opens a PIN profile by itself in mode %s: the picker asks for the PIN',
    async (mode) => {
      serveData(BASE_URL, [alex, sam]);
      const session = usedAt(mode, {
        profile: { id: 'p2', has_pin: true },
        token: 'pvt_still_valid',
      });
      flow('', () => T0);
      expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
      expect(session.get()?.profileToken).toBeUndefined();
      await waitFor(() => expect(screen.getByRole('button', { name: /Sam/ })).toHaveFocus());
      fireEvent.click(screen.getByRole('button', { name: /Sam/ }));
      expect(await screen.findByTestId('pin-entry')).toBeInTheDocument();
    },
  );

  it('a change of server follows the same rule: Every time shows that server picker', async () => {
    serveData(BASE_URL, [alex, sam]);
    serveData(OTHER, [profile({ id: 'q1', name: 'Quinn' }), profile({ id: 'q2', name: 'Robin' })]);
    signedIn(BASE_URL, 'p1');
    const other = signedIn(OTHER, 'q1');
    new ProfileLaunchPrefs(storage, () => T0).setMode(OTHER, 'every');
    flow('', () => T0);
    await screen.findByTestId('server-list');
    // The server with Automatic opens its profile; the one with Every time shows its picker.
    fireEvent.click(serverRow(OTHER));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(other.get()?.profileId).toBeUndefined();
  });

  describe('the "Open automatically?" question', () => {
    /** A TV that never chose a profile: signed in, default setting, nothing offered yet. */
    function newTv() {
      const session = signedIn();
      new ProfileLaunchPrefs(storage).clear(BASE_URL);
      return session;
    }

    it('comes once after the first pick with the default; Yes stores Automatic for this server', async () => {
      serveData(BASE_URL, [alex, sam]);
      newTv();
      const first = flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
      const dialog = await screen.findByTestId('launch-offer');
      expect(dialog).toHaveTextContent('Open Alex automatically next time?');
      expect(stored().mode).toBe('every');
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await waitFor(() => expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument());
      expect(stored()).toMatchObject({ mode: 'automatic', lastProfileId: 'p1', offered: true });
      first.unmount();

      // Restart: the profile opens by itself.
      flow('', () => T0 + 5000);
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(screen.queryByTestId('profile-list')).not.toBeInTheDocument();
    });

    it('No keeps Every time and the question does not come again', async () => {
      serveData(BASE_URL, [alex, sam]);
      newTv();
      flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
      await screen.findByTestId('launch-offer');
      fireEvent.click(screen.getByRole('button', { name: 'No' }));
      await waitFor(() => expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument());
      expect(stored()).toMatchObject({ mode: 'every', offered: true });

      // Switch profile and pick again: no second question.
      fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch profile' }));
      fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument();
    });

    it('Back answers No', async () => {
      serveData(BASE_URL, [alex, sam]);
      newTv();
      flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
      await screen.findByTestId('launch-offer');
      fireEvent.keyDown(window, { keyCode: 461 });
      await waitFor(() => expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument());
      expect(stored().mode).toBe('every');
    });

    it('does not come for a PIN profile, which never opens by itself', async () => {
      serveData(BASE_URL, [alex, sam]);
      newTv();
      server.use(
        http.post(`${BASE_URL}/api/v2/profiles/p2/verify-pin`, () =>
          HttpResponse.json({ valid: true, expires_at: null, profile_token: 'pvt_1' }),
        ),
      );
      flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Sam/ }));
      await screen.findByTestId('pin-entry');
      fireEvent.keyDown(window, { key: '1', keyCode: 49 });
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument();
      expect(stored()).toMatchObject({ lastProfileId: 'p2', lastProfileHasPin: true });
    });

    it('also comes for a kids profile, which opens by itself like any other without a PIN', async () => {
      serveData(BASE_URL, [alex, mia]);
      newTv();
      flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Mia/ }));
      expect(await screen.findByTestId('launch-offer')).toHaveTextContent('Open Mia');
    });

    it('does not come when the account has a single profile that opens without a question', async () => {
      serveData(BASE_URL, [alex]);
      newTv();
      flow('', () => T0);
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument();
      // The pick is still remembered for the picker's start.
      expect(stored()).toMatchObject({ lastProfileId: 'p1', offered: false });
    });

    it('does not come when the mode is not the default any more', async () => {
      serveData(BASE_URL, [alex, sam]);
      newTv();
      // A timed mode that was never offered: only the default (Every time) gets the question.
      storage.set(
        'silo-tv.profileLaunch.v1.' + BASE_URL,
        JSON.stringify({
          v: 1,
          record: {
            mode: 'hour',
            lastProfileId: null,
            lastProfileHasPin: false,
            lastUsedAt: null,
            offered: false,
          },
        }),
      );
      flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
      expect(await screen.findByRole('button', { name: /Title of/ })).toBeInTheDocument();
      expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument();
    });
  });

  describe('the avatar menu', () => {
    async function openMenu() {
      fireEvent.click(await screen.findByRole('button', { name: /Profile menu for/ }));
      await screen.findByTestId('avatar-menu');
    }

    it('"Profile at launch" stores the choice for this server only', async () => {
      serveData(BASE_URL, [alex]);
      serveData(OTHER, [alex]);
      usedAt('automatic');
      signedIn(OTHER, 'p1');
      registry.touch(BASE_URL);
      // Only one server shown at launch: remove the other from the list view by opening BASE directly.
      flow('', () => T0);
      await screen.findByTestId('server-list');
      fireEvent.click(serverRow(BASE_URL));
      await screen.findByRole('button', { name: /Title of/ });
      await openMenu();
      expect(screen.getByTestId('launch-value')).toHaveTextContent('Automatic');
      fireEvent.click(screen.getByRole('menuitem', { name: /Profile at launch/ }));
      fireEvent.click(await screen.findByRole('menuitemradio', { name: /After 12 hours/ }));
      expect(stored(BASE_URL).mode).toBe('halfday');
      expect(stored(OTHER).mode).toBe('automatic');
      // The menu shows the new value at once.
      await waitFor(() =>
        expect(screen.getByTestId('launch-value')).toHaveTextContent('After 12 hours'),
      );
    });

    it('choosing a mode in the menu answers the open question', async () => {
      serveData(BASE_URL, [alex, sam]);
      signedIn();
      new ProfileLaunchPrefs(storage).clear(BASE_URL);
      flow('', () => T0);
      fireEvent.click(await screen.findByRole('button', { name: /Alex/ }));
      await screen.findByTestId('launch-offer');
      fireEvent.click(screen.getByRole('button', { name: 'No' }));
      await openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: /Profile at launch/ }));
      fireEvent.click(await screen.findByRole('menuitemradio', { name: /Automatic/ }));
      expect(stored()).toMatchObject({ mode: 'automatic', offered: true });
    });
  });

  describe('kids profile', () => {
    it('has no Switch server and no Sign out, and Switch profile to a PIN profile asks for the PIN', async () => {
      serveData(BASE_URL, [alex, sam, mia]);
      usedAt('automatic', { profile: { id: 'p3', has_pin: false } });
      flow('', () => T0);
      await screen.findByRole('button', { name: /Title of/ });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Profile menu for Mia' })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Profile menu for/ }));
      await screen.findByTestId('avatar-menu');
      expect(screen.queryByRole('menuitem', { name: 'Switch server' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Switch profile' }));
      fireEvent.click(await screen.findByRole('button', { name: /Sam/ }));
      expect(await screen.findByTestId('pin-entry')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Title of/ })).not.toBeInTheDocument();
    });
  });

  it('stamps the use every five minutes while a profile is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      serveData(BASE_URL, [alex]);
      usedAt('hour');
      let clock = T0 + 1000;
      flow('', () => clock);
      await screen.findByRole('button', { name: /Title of/ });
      clock = T0 + 5 * 60_000 + 1000;
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
      expect(stored().lastUsedAt).toBe(clock);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removing a server forgets its launch setting', async () => {
    serveData(BASE_URL, [alex]);
    serveData(OTHER, [alex]);
    signedIn(BASE_URL, 'p1');
    signedIn(OTHER, 'p1');
    flow();
    await screen.findByTestId('server-list');
    // The server used last is the first row.
    expect(storage.get('silo-tv.profileLaunch.v1.' + OTHER)).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove/ })[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(registry.get(OTHER)).toBeNull());
    expect(storage.get('silo-tv.profileLaunch.v1.' + OTHER)).toBeNull();
    expect(storage.get('silo-tv.profileLaunch.v1.' + BASE_URL)).not.toBeNull();
  });
});
