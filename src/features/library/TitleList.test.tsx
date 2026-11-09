import { fireEvent, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account, problem } from '../../test/apiFixtures';
import { catalogItem, catalogPage, library } from '../../test/flowFixtures';
import { servePlayback } from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { clearInstallationCache } from '../../playback/usePlaybackSession';
import { TitleList } from './TitleList';
import { firstLibraryOfKind, firstVideoLibrary, type LibraryKind } from './queries';

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

function setup(kind?: LibraryKind) {
  const onPlay = vi.fn();
  const onOpenDetail = vi.fn();
  const session = signedIn();
  const view = renderWithSilo(
    <TitleList kind={kind} onPlay={onPlay} onOpenDetail={onOpenDetail} />,
    { session },
  );
  return { onPlay, onOpenDetail, ...view };
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

describe('TitleList', () => {
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
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Films');
    expect(seen.catalog[0]?.searchParams.get('library_id')).toBe('lib-9');
    expect(seen.catalog[0]?.searchParams.get('limit')).toBe('20');
    expect(seen.headers[0]?.get('X-Profile-Id')).toBe('p1');
  });

  it('opens the detail page of a selected movie and does not render a player itself', async () => {
    serve();
    const { onPlay, onOpenDetail } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Second Title/ }));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'm2' });
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
  });

  it('opens the detail page of a series and does not start playback', async () => {
    serve([library()], [catalogItem({ content_id: 's1', title: 'A Series', type: 'series' })]);
    const calls = servePlayback(server);
    const { onPlay, onOpenDetail } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /A Series/ }));
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 's1' });
    expect(onPlay).not.toHaveBeenCalled();
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

  describe('by kind', () => {
    it('lists the first movie library for movies and the first series library for series', async () => {
      const libs = [
        library({ id: 'tv', name: 'Shows', type: 'series' }),
        library({ id: 'film', name: 'Films', type: 'movies' }),
      ];
      const movies = serve(libs);
      const { unmount } = setup('movie');
      expect(await screen.findByRole('heading', { level: 2, name: 'Films' })).toBeInTheDocument();
      expect(movies.catalog[0]?.searchParams.get('library_id')).toBe('film');
      expect(movies.catalog[0]?.searchParams.has('type')).toBe(false);
      unmount();

      const series = serve(libs);
      setup('series');
      expect(await screen.findByRole('heading', { level: 2, name: 'Shows' })).toBeInTheDocument();
      expect(series.catalog[0]?.searchParams.get('library_id')).toBe('tv');
    });

    it('asks a mixed library for its own kind', async () => {
      const seen = serve([library({ id: 'mix', type: 'mixed' })]);
      setup('series');
      await screen.findByTestId('title-list');
      expect(seen.catalog[0]?.searchParams.get('type')).toBe('series');
    });

    it('lists a mixed library for Home without asking for a type', async () => {
      const seen = serve([library({ id: 'mix', type: 'mixed' })]);
      setup('video');
      await screen.findByTestId('title-list');
      expect(seen.catalog[0]?.searchParams.get('library_id')).toBe('mix');
      expect(seen.catalog[0]?.searchParams.has('type')).toBe(false);
    });

    it('says which kind is missing', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v2/user/libraries`, () =>
          HttpResponse.json({ items: [library({ type: 'movies' })] }),
        ),
      );
      setup('series');
      expect(await screen.findByText('This profile has no series library.')).toBeInTheDocument();
    });
  });
});

describe('firstLibraryOfKind', () => {
  it('keeps movies and series apart and lets a mixed library count for both', () => {
    const film = library({ id: 'f', type: 'movies' });
    const show = library({ id: 's', type: 'tvshows' });
    const mix = library({ id: 'm', type: 'Mixed' });
    expect(firstLibraryOfKind([show, film], 'movie')?.id).toBe('f');
    expect(firstLibraryOfKind([film, show], 'series')?.id).toBe('s');
    expect(firstLibraryOfKind([film, mix], 'series')?.id).toBe('m');
    expect(firstLibraryOfKind([film], 'series')).toBeUndefined();
    expect(firstLibraryOfKind([mix], 'video')?.id).toBe('m');
  });
});
