import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account, problem } from '../../test/apiFixtures';
import { catalogItem, catalogPage, library } from '../../test/flowFixtures';
import { servePlayback } from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { clearInstallationCache } from '../../playback/usePlaybackSession';
import { LibraryScreen } from './LibraryScreen';
import { firstVideoLibrary } from './queries';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => clearInstallationCache());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function signedIn() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

function setup() {
  const onBack = vi.fn();
  const session = signedIn();
  const view = renderWithSilo(<LibraryScreen onBack={onBack} />, { session });
  return { onBack, ...view };
}

const titles = [
  catalogItem({ content_id: 'm1', title: 'First Title', year: 2019 }),
  catalogItem({ content_id: 'm2', title: 'Second Title', year: 2021 }),
  catalogItem({ content_id: 'm3', title: 'No Year', year: undefined }),
];

function serve(libraries = [library()], items = titles) {
  const seen: { catalog: URL[]; headers: Headers[] } = { catalog: [], headers: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/user/libraries`, () => HttpResponse.json({ items: libraries })),
    http.get(`${BASE_URL}/api/v2/catalog`, ({ request }) => {
      seen.catalog.push(new URL(request.url));
      seen.headers.push(request.headers);
      return HttpResponse.json(catalogPage(items));
    }),
  );
  return seen;
}

describe('firstVideoLibrary', () => {
  it('skips non-video libraries and accepts movies, series and the aliases', () => {
    const libs = [
      library({ id: 'a', type: 'audiobooks' }),
      library({ id: 'b', type: 'Series' }),
      library({ id: 'c', type: 'movies' }),
    ];
    expect(firstVideoLibrary(libs)?.id).toBe('b');
    expect(firstVideoLibrary([library({ id: 'x', type: 'movie' })])?.id).toBe('x');
    expect(
      firstVideoLibrary([library({ type: 'ebooks' }), library({ type: 'manga' })]),
    ).toBeUndefined();
  });
});

describe('LibraryScreen', () => {
  it('shows a loading cue with row skeletons while the data loads', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/user/libraries`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ items: [library()] });
      }),
      http.get(`${BASE_URL}/api/v2/catalog`, () => HttpResponse.json(catalogPage(titles))),
    );
    setup();
    const loading = screen.getByTestId('loading');
    expect(loading).toHaveTextContent('Loading titles');
    expect(loading.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(await screen.findByTestId('title-list')).toBeInTheDocument();
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
  });

  it('lists the titles of the first video library with title and year', async () => {
    const seen = serve([
      library({ id: 'books', type: 'ebooks' }),
      library({ id: 'lib-9', name: 'Films' }),
    ]);
    setup();
    const list = await screen.findByTestId('title-list');
    const rows = list.querySelectorAll('button');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('First Title');
    expect(rows[0]).toHaveTextContent('2019');
    expect(rows[2]).toHaveTextContent('No Year');
    expect(rows[2]).not.toHaveTextContent(/\d{4}/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Films');
    expect(seen.catalog[0]?.searchParams.get('library_id')).toBe('lib-9');
    expect(seen.catalog[0]?.searchParams.get('limit')).toBe('20');
    expect(seen.headers[0]?.get('X-Profile-Id')).toBe('p1');
    // The first title is focused, so OK on the remote selects it.
    expect(rows[0]).toHaveFocus();
  });

  it('opens the player for a selected movie and returns to the same title with Back', async () => {
    serve();
    const calls = servePlayback(server);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Second Title/ }));
    expect(await screen.findByTestId('player')).toBeInTheDocument();
    expect(screen.queryByTestId('title-list')).not.toBeInTheDocument();
    expect(calls.start).toHaveLength(1);
    fireEvent.keyDown(window, { keyCode: 461 });
    // Back leaves the player, the list is back and the focus is on the title that was played.
    expect(await screen.findByTestId('title-list')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Second Title/ })).toHaveFocus());
    await waitFor(() => expect(calls.stop).toHaveLength(1));
  });

  it('says episodes come later for a series and does not start playback', async () => {
    serve([library()], [catalogItem({ content_id: 's1', title: 'A Series', type: 'series' })]);
    const calls = servePlayback(server);
    setup();
    expect(screen.queryByTestId('series-note')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /A Series/ }));
    expect(screen.getByTestId('series-note')).toHaveTextContent('Episodes come in Phase 2.');
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
    expect(calls.start).toHaveLength(0);
    expect(calls.capabilities).toBe(0);
  });

  it('shows an error with Try again when the libraries fail, and recovers', async () => {
    server.use(
      http.get(
        `${BASE_URL}/api/v2/user/libraries`,
        () => HttpResponse.json(problem('internal', 500), { status: 500 }),
        {
          once: true,
        },
      ),
    );
    setup();
    expect(await screen.findByTestId('error-state')).toHaveTextContent('could not be loaded');
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('title-list')).toBeInTheDocument();
  });

  it('shows an error with Try again when the catalog fails, and retries only the catalog', async () => {
    let libraryCalls = 0;
    server.use(
      http.get(`${BASE_URL}/api/v2/user/libraries`, () => {
        libraryCalls += 1;
        return HttpResponse.json({ items: [library()] });
      }),
      http.get(
        `${BASE_URL}/api/v2/catalog`,
        () => HttpResponse.json(problem('internal', 500), { status: 500 }),
        {
          once: true,
        },
      ),
      http.get(`${BASE_URL}/api/v2/catalog`, () => HttpResponse.json(catalogPage(titles))),
    );
    setup();
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('title-list')).toBeInTheDocument();
    expect(libraryCalls).toBe(1);
  });

  it('says so when there is no movie or series library', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/user/libraries`, () =>
        HttpResponse.json({ items: [library({ type: 'audiobooks' })] }),
      ),
    );
    setup();
    expect(await screen.findByText(/no movie or series library/)).toBeInTheDocument();
  });

  it('says so when the library is empty', async () => {
    serve([library()], []);
    setup();
    expect(await screen.findByText('This library is empty.')).toBeInTheDocument();
  });

  it('goes back with the Back key', async () => {
    serve();
    const { onBack } = setup();
    await screen.findByTestId('title-list');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('signs out: calls logout and clears the session', async () => {
    serve();
    let auth: string | null = null;
    server.use(
      http.post(`${BASE_URL}/api/v2/auth/logout`, ({ request }) => {
        auth = request.headers.get('Authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { session } = setup();
    await screen.findByTestId('title-list');
    expect(session.get()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(session.get()).toBeNull());
    expect(auth).toBe('Bearer a');
  });

  it('clears the session even when the logout call fails', async () => {
    serve();
    server.use(http.post(`${BASE_URL}/api/v2/auth/logout`, () => HttpResponse.error()));
    const { session } = setup();
    await screen.findByTestId('title-list');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(session.get()).toBeNull());
  });
});
