import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { BASE_URL, account } from '../../test/apiFixtures';
import { catalogItem, library } from '../../test/flowFixtures';
import { homeSection, primeHomeCapabilities } from '../../test/homeFixtures';
import { serveLibrary, titles, type LibraryServe } from '../../test/libraryFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey, gridCardKey } from '../../ui/media';
import { LibraryScreen, type LibraryScreenProps } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';
import { libraryRows } from './RecommendedView';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Far longer than the old rest delay: focus alone must not switch anything in this time. */
const LONG_REST = 5000;

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

function setup(
  options: {
    kind?: LibraryScreenProps['kind'];
    memory?: LibraryMemory;
    queryClient?: QueryClient;
  } = {},
) {
  const memory = options.memory ?? new LibraryMemory();
  const onPlay = vi.fn();
  const onOpenDetail = vi.fn();
  const onExploreSection = vi.fn();
  const onOpenCollection = vi.fn();
  const view = renderWithSilo(
    <LibraryScreen
      kind={options.kind ?? 'movie'}
      memory={memory}
      onPlay={onPlay}
      onOpenDetail={onOpenDetail}
      onExploreSection={onExploreSection}
      onOpenCollection={onOpenCollection}
    />,
    { session: signedIn(), queryClient: options.queryClient },
  );
  return { memory, onPlay, onOpenDetail, onExploreSection, onOpenCollection, ...view };
}

/** Focus and key presses that need no real timer, for the tests that fake setTimeout. */
async function focusFaked(key: string) {
  await act(async () => {
    await setFocus(key);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
  expect(getCurrentFocusKey()).toBe(key);
}

async function focus(key: string) {
  await act(async () => {
    await setFocus(key);
  });
  await waitFor(() => expect(getCurrentFocusKey()).toBe(key));
}

const pillNames = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('tab')
    .map((el) => el.textContent);
const rowTitles = () => screen.getAllByTestId('row-title').map((el) => el.textContent);

/** Two movie libraries, a series library and a mixed one, each with a row of its own. */
const LIBRARIES: LibraryServe = {
  libraries: [
    library({ id: 'lib-a', name: 'Films A', type: 'movies' }),
    library({ id: 'lib-b', name: 'Films B', type: 'movie' }),
    library({ id: 'lib-s', name: 'Shows', type: 'series' }),
    library({ id: 'lib-m', name: 'Both', type: 'mixed' }),
  ],
  sections: {
    'lib-a': [homeSection('a-rec', 3)],
    'lib-b': [homeSection('b-rec', 3)],
    'lib-s': [homeSection('s-rec', 3)],
    'lib-m': [
      homeSection('m-rec', 0, {
        items: [
          catalogItem({ content_id: 'mm1', title: 'Mixed Movie', type: 'movie' }),
          catalogItem({ content_id: 'ms1', title: 'Mixed Show', type: 'series' }),
        ],
        total_count: 2,
      }),
    ],
  },
};

describe('library pills', () => {
  it('list the libraries of the tab, and a mixed library on both tabs', async () => {
    serveLibrary(server, LIBRARIES);
    const movies = setup({ kind: 'movie' });
    await screen.findByTestId('library-pills');
    expect(pillNames('library-pills')).toEqual(['Films A', 'Films B', 'Both']);
    movies.unmount();
    setup({ kind: 'series' });
    await screen.findByTestId('library-pills');
    expect(pillNames('library-pills')).toEqual(['Shows', 'Both']);
  });

  it('are left out when the tab has a single library', async () => {
    serveLibrary(server, {
      libraries: [library({ id: 'lib-a', name: 'Films A', type: 'movies' })],
    });
    setup();
    await screen.findByTestId('view-pills');
    expect(screen.queryByTestId('library-pills')).toBeNull();
  });

  it('hovering a library pill with the pointer does not switch; a click does', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.mouseEnter(screen.getByRole('tab', { name: 'Films B' }));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });
      expect(getCurrentFocusKey()).toBe('lib-pill:lib-b');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_REST);
      });
      expect(rowTitles()).toEqual(['Row a-rec']);
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Films B' }));
    await screen.findByText('Row b-rec');
    expect(screen.getByRole('tab', { name: 'Films B' })).toHaveAttribute('aria-selected', 'true');
  });

  it('never switch the library when a pill only has the focus', async () => {
    const calls = serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await focusFaked('lib-pill:lib-b');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_REST);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(rowTitles()).toEqual(['Row a-rec']);
    expect(screen.getByRole('tab', { name: 'Films A' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Films B' })).toHaveAttribute('aria-selected', 'false');
    expect(calls.sections.map((read) => read.id)).toEqual(['lib-a']);
  });

  it('show the library on OK', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    await focus('lib-pill:lib-b');
    await pressKey(KEY.enter);
    await screen.findByText('Row b-rec');
  });

  it('let Down from a focused pill that is not selected enter the content that is shown', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    await focus('lib-pill:lib-b');
    // Down passes the view pills (on their selected one) and enters the rows that are shown.
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-a/a-rec', 'a-rec-1'));
    expect(rowTitles()).toEqual(['Row a-rec']);
    expect(screen.getByRole('tab', { name: 'Films A' })).toHaveAttribute('aria-selected', 'true');
  });

  it('land on the selected pill when Up comes back from the content', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    await focus('lib-pill:lib-b');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('lib-pill:lib-a');
  });

  it('are remembered per tab', async () => {
    serveLibrary(server, LIBRARIES);
    const memory = new LibraryMemory();
    const first = setup({ memory });
    await screen.findByText('Row a-rec');
    await focus('lib-pill:lib-b');
    await pressKey(KEY.enter);
    await screen.findByText('Row b-rec');
    expect(memory.libraryOf('movie')).toBe('lib-b');
    first.unmount();
    // The same tab again: the second library is back, selected.
    const second = setup({ memory });
    await screen.findByText('Row b-rec');
    expect(screen.getByRole('tab', { name: 'Films B' })).toHaveAttribute('aria-selected', 'true');
    second.unmount();
    // The other tab has a choice of its own: the first series library.
    setup({ kind: 'series', memory });
    await screen.findByText('Row s-rec');
    expect(memory.libraryOf('series')).toBeUndefined();
  });

  it('count a mixed library for both tabs, each asking the server for its own kind', async () => {
    const calls = serveLibrary(server, LIBRARIES);
    const memory = new LibraryMemory();
    memory.selectLibrary('series', 'lib-m');
    memory.selectView('series', 'browse');
    const series = setup({ kind: 'series', memory });
    await waitFor(() => expect(calls.browse.length).toBeGreaterThan(0));
    // Every read of the series tab names the mixed library and asks for series.
    expect(calls.browse.map((q) => [q.get('library_id'), q.get('type')])).toEqual(
      calls.browse.map(() => ['lib-m', 'series']),
    );
    series.unmount();
    calls.browse.length = 0;
    memory.selectLibrary('movie', 'lib-m');
    memory.selectView('movie', 'browse');
    setup({ kind: 'movie', memory });
    await waitFor(() => expect(calls.browse.length).toBeGreaterThan(0));
    expect(calls.browse.map((q) => [q.get('library_id'), q.get('type')])).toEqual(
      calls.browse.map(() => ['lib-m', 'movie']),
    );
  });

  it('show a calm message when the profile has no library of the kind', async () => {
    serveLibrary(server, {
      libraries: [library({ id: 'lib-s', name: 'Shows', type: 'series' })],
    });
    setup({ kind: 'movie' });
    expect(await screen.findByTestId('library-none')).toHaveTextContent(
      'This profile has no movie library.',
    );
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('show a skeleton while the libraries load, and an error with Try again when they fail', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/user/libraries`, () => new HttpResponse(null, { status: 500 })),
    );
    setup();
    expect(screen.getByTestId('library-loading')).toBeInTheDocument();
    expect(await screen.findByTestId('library-error')).toHaveTextContent(
      'The titles could not be loaded.',
    );
    serveLibrary(server, LIBRARIES);
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    await screen.findByText('Row a-rec');
  });
});

describe('sub-view pills', () => {
  it('list Recommended, Library and Collections with Recommended selected', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByTestId('view-pills');
    expect(pillNames('view-pills')).toEqual(['Recommended', 'Library', 'Collections']);
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('never switch the view when a pill only has the focus', async () => {
    serveLibrary(server, LIBRARIES);
    const { memory } = setup();
    await screen.findByText('Row a-rec');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await focusFaked('lib-view:browse');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_REST);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByTestId('browse')).toBeNull();
    expect(screen.getByTestId('recommended')).toBeInTheDocument();
    expect(memory.viewOf('movie')).toBe('recommended');
  });

  it('switch to a view on OK and remember it', async () => {
    serveLibrary(server, LIBRARIES);
    const { memory } = setup();
    await screen.findByText('Row a-rec');
    await focus('lib-view:browse');
    await pressKey(KEY.enter);
    await screen.findByTestId('browse');
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    expect(memory.viewOf('movie')).toBe('browse');
  });

  it('marks the Recommended rows box as scrolled by transform', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    expect(document.querySelector('.library-rows')).toHaveAttribute(
      'data-transform-scrolled',
      'page',
    );
  });

  it('focuses a hovered card of a lower row without scrolling the page; the next key does', async () => {
    serveLibrary(server, {
      ...LIBRARIES,
      sections: { 'lib-a': [homeSection('x', 3), homeSection('y', 3), homeSection('z', 3)] },
    });
    setup();
    await screen.findByText('Row y');
    await focus(cardFocusKey('lib-a/x', 'x-1'));
    const inner = () => document.querySelector<HTMLElement>('.library-rows-inner')!;
    expect(inner().style.transform).toBe('translateY(0px)');
    const lower = cardFocusKey('lib-a/y', 'y-1');
    fireEvent.mouseEnter(document.querySelector(`[data-focus-key="${lower}"]`)!);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(lower));
    await act(async () => {});
    expect(inner().style.transform).toBe('translateY(0px)');
    // Down moves on from the hovered card to the third row and the page scrolls to it.
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-a/z', 'z-1'));
    await waitFor(() => expect(inner().style.transform).toMatch(/^translateY\(-[1-9]\d+px\)$/));
  });

  it('switch to Collections on OK', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    await focus('lib-view:collections');
    await pressKey(KEY.enter);
    await screen.findByTestId('collections-empty');
  });

  it('let Down from a focused view pill enter the content that is shown', async () => {
    serveLibrary(server, LIBRARIES);
    setup();
    await screen.findByText('Row a-rec');
    await focus('lib-view:browse');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-a/a-rec', 'a-rec-1'));
    expect(screen.getByTestId('recommended')).toBeInTheDocument();
    expect(screen.queryByTestId('browse')).toBeNull();
  });

  it('keep a card focus per view: Recommended and Browse each return to their own', async () => {
    serveLibrary(server, {
      ...LIBRARIES,
      sections: { 'lib-a': [homeSection('x', 3), homeSection('y', 3)] },
    });
    setup();
    await screen.findByText('Row y');
    // Recommended: the third card of the second row.
    const remembered = cardFocusKey('lib-a/y', 'y-3');
    await focus(remembered);
    await focus('lib-view:browse');
    await pressKey(KEY.enter);
    await screen.findByTestId('browse');
    // Browse: Down reaches the toolbar, Down again the grid; the seventh poster is the one to keep.
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    const seventh = gridCardKey('browse:lib-a:movie', 'Title7');
    expect(getCurrentFocusKey()).toBe(seventh);
    await focus('lib-view:recommended');
    await pressKey(KEY.enter);
    await screen.findByTestId('recommended');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(remembered);
    await focus('lib-view:browse');
    await pressKey(KEY.enter);
    await screen.findByTestId('browse');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(seventh);
  });
});

describe('Recommended', () => {
  it('shows the library sections as rows in server order, without empty ones and the featured one (the hero)', async () => {
    const calls = serveLibrary(server, {
      sections: {
        'lib-1': [
          homeSection('first', 3, { title: 'First' }),
          homeSection('hero', 3, { title: 'Hero', featured: true }),
          homeSection('empty', 0, { title: 'Empty', items: [] }),
          homeSection('second', 2, { title: 'Second' }),
        ],
      },
    });
    const queryClient = newQueryClient();
    primeHomeCapabilities(queryClient);
    setup({ queryClient });
    await screen.findByText('First');
    expect(rowTitles()).toEqual(['First', 'Second']);
    expect(calls.sections).toHaveLength(1);
    const query = calls.sections[0]!.query;
    // The item limit is the row length; the images are the rows' size.
    expect(query.get('item_limit')).toBe('20');
    expect(query.get('poster_width')).toBe('352');
  });

  it('cuts a row to 20 cards and ends it with Explore all, which hands the row on', async () => {
    serveLibrary(server, {
      sections: {
        'lib-1': [
          homeSection('big', 0, {
            title: 'Big',
            items: titles('Big', 30),
            total_count: 90,
            has_more: true,
          }),
          homeSection('small', 2, { title: 'Small' }),
        ],
      },
    });
    const { onExploreSection } = setup();
    await screen.findByText('Big');
    await focus(cardFocusKey('lib-1/big', 'Big1'));
    // 20 cards and the Explore all card are in the row, which keeps only a window mounted.
    for (let i = 0; i < 20; i += 1) await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-1/big', 'explore'));
    await pressKey(KEY.enter);
    expect(onExploreSection).toHaveBeenCalledWith({
      id: 'big',
      title: 'Big',
      library: { id: 'lib-1', type: undefined },
    });
    // A row that shows all it has has no such card.
    await focus(cardFocusKey('lib-1/small', 'small-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-1/small', 'small-2'));
  });

  it('opens a card through the item opener', async () => {
    serveLibrary(server);
    const { onOpenDetail } = setup();
    await screen.findByText('Row lib-1-rec');
    await focus(cardFocusKey('lib-1/lib-1-rec', 'lib-1-rec-2'));
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'lib-1-rec-2' });
  });

  it('shows only the tab’s kind of a mixed library, and asks for the kind when exploring', async () => {
    serveLibrary(server, LIBRARIES);
    const memory = new LibraryMemory();
    memory.selectLibrary('series', 'lib-m');
    const { onExploreSection } = setup({ kind: 'series', memory });
    await screen.findByText('Row m-rec');
    expect(screen.getByRole('button', { name: /Mixed Show/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mixed Movie/ })).toBeNull();
    // The section holds more than the shown kind: its row ends with Explore all for that kind.
    await focus(cardFocusKey('lib-m/m-rec', 'ms1'));
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    expect(onExploreSection).toHaveBeenCalledWith({
      id: 'm-rec',
      title: 'Row m-rec',
      library: { id: 'lib-m', type: 'series' },
    });
  });

  it('shows rows of skeleton cards while the sections load', async () => {
    serveLibrary(server);
    server.use(
      http.get(`${BASE_URL}/api/v2/library/:id/sections`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json({ sections: [homeSection('slow')] });
      }),
    );
    setup();
    expect(await screen.findByTestId('recommended-loading')).toBeInTheDocument();
    expect(screen.getAllByTestId('row-skeleton').length).toBeGreaterThan(0);
    await screen.findByText('Row slow');
    expect(screen.queryByTestId('recommended-loading')).toBeNull();
  });

  it('shows a note when the library has no sections', async () => {
    const calls = serveLibrary(server, { sections: { 'lib-1': [] } });
    setup();
    expect(await screen.findByTestId('recommended-empty')).toBeInTheDocument();
    expect(calls.sections).toHaveLength(1);
  });

  it('shows an error with Try again when the sections cannot be read', async () => {
    serveLibrary(server);
    server.use(
      http.get(
        `${BASE_URL}/api/v2/library/:id/sections`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    setup();
    expect(await screen.findByTestId('recommended-error')).toBeInTheDocument();
    serveLibrary(server);
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    await screen.findByText('Row lib-1-rec');
  });
});

describe('libraryRows', () => {
  const lib = library({ id: 'lib-1', type: 'movies' });
  const section = (overrides: Partial<Parameters<typeof libraryRows>[0][number]> = {}) => ({
    id: 's',
    title: 'S',
    section_type: 'recently_added',
    featured: false,
    total_count: 2,
    items: titles('T', 2),
    ...overrides,
  });

  it('uses landscape cards for rows in progress and poster cards for the rest', () => {
    const rows = libraryRows(
      [
        section({ id: 'cw', section_type: 'continue_watching' }),
        section({ id: 'ra', section_type: 'recently_added' }),
      ],
      lib,
      'movie',
      (s) => s.title,
    );
    expect(rows.map((row) => row.shape)).toEqual(['landscape', 'poster']);
  });

  it('prefixes the row id with the library, so two libraries never share a focus memory', () => {
    expect(libraryRows([section()], lib, 'movie', (s) => s.title)[0]!.id).toBe('lib-1/s');
  });

  it('leaves out the section that is the hero carousel, and only that one', () => {
    const rows = libraryRows(
      [
        section({ id: 'hero', featured: true }),
        section({ id: 'other', featured: true }),
        section({ id: 'plain' }),
      ],
      lib,
      'movie',
      (s) => s.title,
      'hero',
    );
    expect(rows.map((row) => row.id)).toEqual(['lib-1/other', 'lib-1/plain']);
  });

  it('marks a row with more than it shows', () => {
    const rows = libraryRows(
      [
        section({ id: 'a' }),
        section({ id: 'b', total_count: 50 }),
        section({ id: 'c', has_more: true }),
      ],
      lib,
      'movie',
      (s) => s.title,
    );
    expect(rows.map((row) => row.hasMore)).toEqual([false, true, true]);
  });
});
