import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { useCallback, useRef, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import {
  getCurrentFocusKey,
  Navigator,
  setFocus,
  useBackHandler,
  type NavApi,
} from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import { ShellBackContext, type ContentBack } from '../../app/shell/ShellBack';
import { BarAwayStore, ShellBarContext } from '../../app/shell/ShellBar';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import { boxSetSummary } from '../../test/boxSetFixtures';
import { branding } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { pressPlayKey } from '../../test/playKey';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import {
  episodeMatch,
  matches,
  personMatch,
  serveSearch,
  type SearchCalls,
  type SearchServe,
} from '../../test/searchFixtures';
import { cardFocusKey, gridCardKey, rowHeight } from '../../ui/media';
import type { BoxSetTarget } from '../boxset/boxSetMemory';
import type { DetailTarget } from '../detail/detailMemory';
import type { PersonTarget } from '../person/personMemory';
import { http, HttpResponse } from 'msw';
import { SEARCH_GRID } from './layout';
import { keyFocusKey } from './keys';
import { SearchMemory } from './searchMemory';
import { SearchScreen } from './SearchScreen';
import { CardPrefsProvider } from '../../ui/media';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const focusOn = (focusKey: string) => act(async () => void (await setFocus(focusKey)));

/** The first element with this text: a card without artwork shows its title twice (tile and caption). */
const found = async (text: string) => (await screen.findAllByText(text))[0]!;
const shown = (text: string) => screen.getAllByText(text)[0]!;

const key = keyFocusKey;
const titleCard = (id: string) => gridCardKey('search', id);
const boxSetCard = (id: string) => cardFocusKey('search-boxsets', id);
const personCard = (id: string) => cardFocusKey('search-people', id);
const pill = (id: string) => `search-pill:${id}`;

/** Clicks the keys (the Magic Remote's way of typing): one per character. */
function type(text: string) {
  for (const char of text) {
    fireEvent.click(screen.getByTestId(char === ' ' ? 'osk-space' : `osk-${char}`));
  }
}

type Screen =
  | { name: 'search' }
  | ({ name: 'detail' } & DetailTarget)
  | ({ name: 'boxSet' } & BoxSetTarget)
  | ({ name: 'person' } & PersonTarget);

/** What the shell does with Back for a tab's content: ask it first, then act itself. */
function BackHost({ onShellBack, children }: { onShellBack: () => void; children: ReactNode }) {
  const handler = useRef<ContentBack | null>(null);
  const register = useCallback((next: ContentBack | null) => {
    handler.current = next;
  }, []);
  useBackHandler(() => {
    if (!handler.current?.()) onShellBack();
  });
  return <ShellBackContext.Provider value={register}>{children}</ShellBackContext.Provider>;
}

const keepingClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });

/**
 * The Search tab on a screen stack with stub pages: what a result opens is pushed as a stub and
 * Back pops it, like the flow does. The search memory is kept outside the screen, like the shell's.
 */
function setup(
  options: SearchServe & {
    memory?: SearchMemory;
    queryClient?: QueryClient;
    onShellBack?: () => void;
    /** Where the screen tells the shell's top bar that it has left its top. */
    barStore?: BarAwayStore;
  } = {},
) {
  const {
    memory = new SearchMemory(),
    queryClient,
    onShellBack = vi.fn(),
    barStore = new BarAwayStore(),
    ...serve
  } = options;
  const calls = serveSearch(server, serve);
  server.use(http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.json(branding())));
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const onPlay = vi.fn();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) => {
    if (current.name === 'detail') {
      return <div data-testid="detail-stub">{JSON.stringify(current)}</div>;
    }
    if (current.name === 'boxSet') {
      return <div data-testid="boxset-stub">{JSON.stringify(current)}</div>;
    }
    if (current.name === 'person') {
      return <div data-testid="person-stub">{JSON.stringify(current)}</div>;
    }
    return (
      <BackHost onShellBack={onShellBack}>
        <SearchScreen
          memory={memory}
          onPlay={onPlay}
          onOpenDetail={(target) => nav.push({ name: 'detail', ...target })}
          onOpenPerson={(target) => nav.push({ name: 'person', ...target })}
          onOpenBoxSet={(target) => nav.push({ name: 'boxSet', ...target })}
        />
      </BackHost>
    );
  };
  const view = render(
    <QueryClientProvider client={queryClient ?? newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <CardPrefsProvider>
            <ShellBarContext.Provider value={barStore}>
              <Navigator<Screen> initial={{ name: 'search' }} renderScreen={renderScreen} />
            </ShellBarContext.Provider>
          </CardPrefsProvider>
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { memory, calls, onShellBack, onPlay, ...view };
}

const field = () => screen.getByTestId('search-field');
const lastTitleRead = (calls: SearchCalls) => calls.titles[calls.titles.length - 1]!.query;

/** All the endpoints a full server answers: titles, box sets, people and the capabilities. */
const FULL: SearchServe = {
  capabilities: { box_sets: true, people_media_scope: true, video_with_episodes_scope: true },
  titles: () => [...matches('Title', 6)],
  boxSets: () => [
    boxSetSummary({ id: 'bs-1', title: 'Great Saga Box Set' }),
    boxSetSummary({ id: 'bs-2', title: 'Other Saga Box Set', library_id: 'lib-2' }),
  ],
  people: () => [personMatch({ id: 'pers-1' }), personMatch({ id: 'pers-2', name: 'Sage Two' })],
};

describe('SearchScreen: before a query', () => {
  it('shows the empty field, the hint with the server name and no segments', async () => {
    setup({ capabilities: {} });
    expect(await found('Search Test Server')).toBeInTheDocument();
    expect(shown('Find movies and series')).toBeInTheDocument();
    expect(field()).toHaveTextContent('Search');
    expect(screen.queryByTestId('search-text')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('adds "and people" to the hint only when the server offers people', async () => {
    setup({ capabilities: { people_media_scope: true } });
    expect(await found('Find movies, series and people')).toBeInTheDocument();
  });

  it('lays the keyboard out in seven columns, with the focus on "a"', async () => {
    setup();
    await focusKeyIs(key('a'));
    const keys = within(screen.getByTestId('search-keyboard')).getAllByRole('button');
    expect(keys).toHaveLength(45);
    expect(screen.getByTestId('osk-space')).toHaveStyle({ gridColumn: 'span 3' });
    expect(screen.getByTestId('osk-delete')).toHaveStyle({ gridColumn: 'span 2' });
    expect(screen.getByRole('button', { name: 'Space' })).toBe(screen.getByTestId('osk-space'));
  });
});

describe('SearchScreen: the keyboard', () => {
  it('types with OK and keeps the focus on the keyboard', async () => {
    setup();
    await focusKeyIs(key('a'));
    await pressKey(KEY.enter);
    await pressKey(KEY.right);
    await focusKeyIs(key('b'));
    await pressKey(KEY.enter);
    expect(screen.getByTestId('search-text')).toHaveTextContent('ab');
    expect(getCurrentFocusKey()).toBe(key('b'));
    await sleep(50);
    expect(getCurrentFocusKey()).toBe(key('b'));
  });

  it('types umlauts, digits and a space, and Delete removes the last character', async () => {
    setup();
    type('mädchen 7');
    expect(screen.getByTestId('search-text')).toHaveTextContent('mädchen 7');
    fireEvent.click(screen.getByTestId('osk-delete'));
    fireEvent.click(screen.getByTestId('osk-delete'));
    expect(screen.getByTestId('search-text')).toHaveTextContent('mädchen');
  });

  it('clears the whole text and shows the placeholder again', async () => {
    setup();
    type('sag');
    fireEvent.click(screen.getByTestId('osk-clear'));
    expect(screen.queryByTestId('search-text')).toBeNull();
    expect(field()).toHaveTextContent('Search');
  });

  it('types with OK on the Delete and Clear keys too', async () => {
    setup();
    type('sag');
    await focusOn(key('delete'));
    await pressKey(KEY.enter);
    expect(screen.getByTestId('search-text')).toHaveTextContent('sa');
    await focusOn(key('clear'));
    await pressKey(KEY.enter);
    expect(screen.queryByTestId('search-text')).toBeNull();
  });

  it('moves by index with the arrow keys, without the library searching', async () => {
    setup();
    await focusKeyIs(key('a'));
    const spy = spySpatialSearch();
    await pressKey(KEY.down);
    await focusKeyIs(key('h'));
    await pressKey(KEY.right);
    await focusKeyIs(key('i'));
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs(key('7'));
    await pressKey(KEY.down);
    await focusKeyIs(key('space'));
    await pressKey(KEY.right);
    await focusKeyIs(key('delete'));
    await pressKey(KEY.up);
    await focusKeyIs(key('9'));
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    await focusKeyIs(key('7'));
    expect(spy.count).toBe(0);
    spy.restore();
  });

  it('stops at the left edge of the keyboard', async () => {
    setup();
    await focusKeyIs(key('a'));
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(key('a'));
  });

  it('does not take more than 200 characters', async () => {
    const memory = new SearchMemory();
    memory.setQuery('a'.repeat(200));
    setup({ memory });
    type('b');
    expect(memory.query).toHaveLength(200);
    expect(screen.getByTestId('search-text').textContent).toBe('a'.repeat(200));
  });
});

describe('SearchScreen: searching', () => {
  it('sends nothing for 300 ms after the last key, then one request', async () => {
    const { calls } = setup({ capabilities: {} });
    await focusKeyIs(key('a'));
    type('s');
    await sleep(100);
    type('a');
    await sleep(100);
    expect(calls.titles).toHaveLength(0);
    await waitFor(() => expect(calls.titles).toHaveLength(1));
    await sleep(500);
    expect(calls.titles).toHaveLength(1);
    expect(lastTitleRead(calls).get('q')).toBe('sa');
  });

  it('asks for 40 titles of "video" without a cursor, posters at the grid width', async () => {
    const { calls } = setup({ capabilities: {} });
    type('sag');
    await waitFor(() => expect(calls.titles).toHaveLength(1));
    const query = lastTitleRead(calls);
    expect(query.get('type')).toBe('video');
    expect(query.get('limit')).toBe('40');
    expect(query.get('cursor')).toBeNull();
    expect(query.get('sort')).toBeNull();
    expect(query.get('poster_width')).toBe('520');
  });

  it('cancels the request of the old text when the text changes', async () => {
    let release = () => undefined as void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = setup({ capabilities: {}, holdTitles: hold });
    type('s');
    await waitFor(() => expect(calls.titles).toHaveLength(1));
    const first = calls.titles[0]!;
    expect(first.signal.aborted).toBe(false);
    type('a');
    await waitFor(() => expect(first.signal.aborted).toBe(true));
    release();
    await waitFor(() => expect(calls.titles).toHaveLength(2));
    expect(lastTitleRead(calls).get('q')).toBe('sa');
  });

  it('sends the text without the space at its end', async () => {
    const { calls } = setup({ capabilities: {} });
    type('star ');
    await waitFor(() => expect(calls.titles).toHaveLength(1));
    expect(lastTitleRead(calls).get('q')).toBe('star');
  });

  it('shows "Searching …" and a skeleton shaped like the grid while it waits', async () => {
    setup({ capabilities: {} });
    type('sag');
    expect(await screen.findByTestId('grid-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('search-count')).toHaveTextContent('Searching …');
    // 2 rows of the 4 columns of the results grid.
    expect(screen.getAllByTestId('card-skeleton')).toHaveLength(8);
    await found('Title 1');
    expect(screen.queryByTestId('grid-skeleton')).toBeNull();
  });
});

describe('SearchScreen: the titles', () => {
  it('shows the titles with their years and the number of results, under the segments', async () => {
    setup({ capabilities: {}, titles: () => matches('Title', 3) });
    type('sag');
    expect(await found('Title 1')).toBeInTheDocument();
    expect(shown('2001')).toBeInTheDocument();
    expect(screen.getByTestId('search-count')).toHaveTextContent('3 results');
    const segments = within(screen.getByTestId('search-segments')).getAllByRole('tab');
    expect(segments.map((s) => s.textContent)).toEqual(['All', 'Movies', 'Series']);
    expect(segments[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('says "1 result" and "N+ results" when the server only estimates', async () => {
    const one = setup({ capabilities: {}, titles: () => matches('Title', 1) });
    type('sag');
    await found('Title 1');
    expect(screen.getByTestId('search-count')).toHaveTextContent(/^1 result$/);
    one.unmount();

    setup({ capabilities: {}, titles: () => matches('Title', 5), totalExact: false });
    type('sag');
    await found('Title 1');
    expect(screen.getByTestId('search-count')).toHaveTextContent('5+ results');
  });

  it('searches movies, series and episodes for "All" only with video_with_episodes_scope', async () => {
    const withScope = setup({ capabilities: { video_with_episodes_scope: true } });
    type('sag');
    await waitFor(() => expect(withScope.calls.titles).toHaveLength(1));
    expect(lastTitleRead(withScope.calls).get('type')).toBe('video_with_episodes');
    withScope.unmount();

    const without = setup({ capabilities: {} });
    type('sag');
    await waitFor(() => expect(without.calls.titles).toHaveLength(1));
    expect(lastTitleRead(without.calls).get('type')).toBe('video');
  });

  it('treats a failed capabilities read as "no capabilities"', async () => {
    const { calls } = setup({ capabilities: 'fail' });
    type('sag');
    await waitFor(() => expect(calls.titles).toHaveLength(1));
    expect(lastTitleRead(calls).get('type')).toBe('video');
    expect(calls.boxSets).toHaveLength(0);
    expect(calls.people).toHaveLength(0);
  });

  it('shows an episode under its series, with "S1 · E2 · Title"', async () => {
    setup({
      capabilities: { video_with_episodes_scope: true },
      titles: () => [
        episodeMatch({ series_poster_url: '/img/series-poster.webp' }),
        ...matches('Title', 1),
      ],
    });
    type('sag');
    expect(await found('Sagas of Old')).toBeInTheDocument();
    expect(shown('S1 · E2 · The Pilot')).toBeInTheDocument();
    const art = document.querySelector('img[src$="/img/series-poster.webp"]');
    expect(art).not.toBeNull();
  });

  it('shows an error with a retry button when the titles cannot be read, and recovers', async () => {
    let failing = true;
    const { calls } = setup({
      capabilities: {},
      titles: () => (failing ? 'fail' : matches('Title', 2)),
    });
    type('sag');
    const error = await screen.findByTestId('search-error');
    expect(error).toHaveTextContent('The search failed.');
    expect(screen.queryAllByText('No results')).toHaveLength(0);
    failing = false;
    const before = calls.titles.length;
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    expect(await found('Title 1')).toBeInTheDocument();
    expect(calls.titles.length).toBeGreaterThan(before);
  });

  it('starts over from the first page when the server no longer knows the cursor', async () => {
    const { calls } = setup({
      capabilities: {},
      titles: () => matches('Title', 25),
      pageSize: 10,
      staleCursorAfter: '10',
    });
    type('sag');
    const cursors = () => calls.titles.map((read) => read.query.get('cursor'));
    await waitFor(() => expect(cursors().length).toBeGreaterThanOrEqual(4));
    // First page, the page that failed, the restart from the first page, the same page again.
    expect(cursors().slice(0, 4)).toEqual([null, '10', null, '10']);
    expect(shown('Title 1')).toBeInTheDocument();
  });
});

describe('SearchScreen: segments', () => {
  it('switches only on OK, and then searches again at once', async () => {
    const { calls } = setup({ ...FULL });
    type('sag');
    await found('Title 1');
    const before = calls.titles.length;
    await focusOn(pill('movies'));
    await sleep(200);
    // Focus alone changes nothing.
    expect(calls.titles).toHaveLength(before);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    await pressKey(KEY.enter);
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(calls.titles.length).toBe(before + 1));
    expect(lastTitleRead(calls).get('type')).toBe('movie');
  });

  it('searches series with the series type', async () => {
    const { calls } = setup({ ...FULL });
    type('sag');
    await found('Title 1');
    await focusOn(pill('series'));
    await pressKey(KEY.enter);
    await waitFor(() => expect(lastTitleRead(calls).get('type')).toBe('series'));
  });

  it('keeps the segment on the pill after it is picked, so the user can go back', async () => {
    setup({ ...FULL, titles: (q) => (q.get('type') === 'series' ? [] : matches('Title', 2)) });
    type('sag');
    await found('Title 1');
    await focusOn(pill('series'));
    await pressKey(KEY.enter);
    await screen.findByTestId('search-empty');
    expect(getCurrentFocusKey()).toBe(pill('series'));
  });
});

describe('SearchScreen: box sets', () => {
  it('reads up to 4 box sets with the query and shows them above the titles', async () => {
    const { calls } = setup({ ...FULL, people: () => [] });
    type('sag');
    expect(await found('Great Saga Box Set')).toBeInTheDocument();
    expect(screen.getByTestId('row-search-boxsets')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-search-boxsets')).getByText('Box Sets')).toBeVisible();
    expect(calls.boxSets).toHaveLength(1);
    expect(calls.boxSets[0]!.query.get('q')).toBe('sag');
    expect(calls.boxSets[0]!.query.get('limit')).toBe('4');
    // The box set card has its badge and film count.
    expect(screen.getAllByTestId('card-pill-start')[0]).toHaveTextContent('BOX SET');
  });

  it('is not read without the box_sets capability', async () => {
    const { calls } = setup({ ...FULL, capabilities: { people_media_scope: true } });
    type('sag');
    await found('Title 1');
    await sleep(100);
    expect(calls.boxSets).toHaveLength(0);
    expect(screen.queryByTestId('row-search-boxsets')).toBeNull();
  });

  it('is read for Movies, and never for Series', async () => {
    const { calls } = setup({ ...FULL });
    type('sag');
    await found('Great Saga Box Set');
    await focusOn(pill('movies'));
    await pressKey(KEY.enter);
    await screen.findByTestId('row-search-boxsets');
    // The same text and the same box set read: it is kept, not asked for again.
    expect(calls.boxSets).toHaveLength(1);
    await focusOn(pill('series'));
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('row-search-boxsets')).toBeNull());
    await found('Title 1');
    expect(calls.boxSets).toHaveLength(1);
  });

  it('shows no box sets and no error when the read fails', async () => {
    setup({ ...FULL, boxSets: () => 'fail' });
    type('sag');
    await found('Title 1');
    await waitFor(() => expect(screen.getByTestId('search-count')).toHaveTextContent('6 results'));
    expect(screen.queryByTestId('row-search-boxsets')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is the result when only box sets match: no "No results"', async () => {
    setup({ ...FULL, titles: () => [], people: () => [] });
    type('sag');
    expect(await found('Great Saga Box Set')).toBeInTheDocument();
    await sleep(100);
    expect(screen.queryByTestId('search-empty')).toBeNull();
    expect(screen.queryByTestId('search-error')).toBeNull();
  });
});

describe('SearchScreen: people', () => {
  it('reads 12 people for "All" in the scope of the "All" titles and shows them', async () => {
    const { calls } = setup({ ...FULL });
    type('sag');
    expect(await found('Sage Two')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-search-people')).getByText('People')).toBeVisible();
    expect(calls.people).toHaveLength(1);
    expect(calls.people[0]!.query.get('q')).toBe('sag');
    expect(calls.people[0]!.query.get('limit')).toBe('12');
    expect(calls.people[0]!.query.get('media_scope')).toBe('video_with_episodes');
  });

  it('uses the "video" scope where episodes cannot be searched', async () => {
    const { calls } = setup({
      ...FULL,
      capabilities: { people_media_scope: true },
    });
    type('sag');
    await found('Sage Two');
    expect(calls.people[0]!.query.get('media_scope')).toBe('video');
  });

  it('is not read without people_media_scope, nor for Movies or Series', async () => {
    const none = setup({ ...FULL, capabilities: { box_sets: true } });
    type('sag');
    await found('Title 1');
    await sleep(100);
    expect(none.calls.people).toHaveLength(0);
    none.unmount();

    const { calls } = setup({ ...FULL });
    type('sag');
    await found('Sage Two');
    await focusOn(pill('movies'));
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('row-search-people')).toBeNull());
    await focusOn(pill('series'));
    await pressKey(KEY.enter);
    await found('Title 1');
    await sleep(100);
    expect(calls.people).toHaveLength(1);
  });

  it('shows no people and no error when the read fails', async () => {
    setup({ ...FULL, people: () => 'fail' });
    type('sag');
    await found('Title 1');
    await waitFor(() => expect(screen.getByTestId('search-count')).toHaveTextContent('6 results'));
    expect(screen.queryByTestId('row-search-people')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SearchScreen: nothing found', () => {
  it('says "No results" and suggests another term', async () => {
    setup({ ...FULL, titles: () => [], boxSets: () => [], people: () => [] });
    type('zzz');
    const empty = await screen.findByTestId('search-empty');
    expect(empty).toHaveTextContent('No results');
    expect(empty).toHaveTextContent('Try a different search term');
  });

  it('is not "No results" when only people match', async () => {
    setup({ ...FULL, titles: () => [], boxSets: () => [] });
    type('sag');
    expect(await found('Sage Two')).toBeInTheDocument();
    await sleep(100);
    expect(screen.getByTestId('row-search-people')).toBeInTheDocument();
    expect(screen.queryByTestId('search-empty')).toBeNull();
  });

  it('shows no message and no segments once the text is gone again', async () => {
    setup({ ...FULL });
    type('s');
    await found('Title 1');
    fireEvent.click(screen.getByTestId('osk-delete'));
    expect(await screen.findByTestId('search-hint')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryAllByText('Title 1')).toHaveLength(0);
  });
});

describe('SearchScreen: moving between the keyboard and the results', () => {
  /** Puts the focus on the last key of the row and presses Right. */
  async function rightFromKeyboard(id = 'g') {
    await focusOn(key(id));
    await pressKey(KEY.right);
  }

  it('goes from the right edge of the keyboard to the box sets first', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Title 1');
    await rightFromKeyboard();
    await focusKeyIs(boxSetCard('bs-1'));
  });

  it('goes to the people when there are no box sets, then to the titles, then to the segments', async () => {
    const withPeople = setup({ ...FULL, boxSets: () => [] });
    type('sag');
    await found('Title 1');
    await rightFromKeyboard();
    await focusKeyIs(personCard('pers-1'));
    withPeople.unmount();

    const titlesOnly = setup({ capabilities: {}, titles: () => matches('Title', 3) });
    type('sag');
    await found('Title 1');
    await rightFromKeyboard('n');
    await focusKeyIs(titleCard('title-1'));
    titlesOnly.unmount();

    setup({ capabilities: {}, titles: () => [] });
    type('sag');
    await screen.findByTestId('search-empty');
    await rightFromKeyboard();
    await focusKeyIs(pill('all'));
  });

  it('does nothing from the right edge while there is no query', async () => {
    setup();
    await focusKeyIs(key('a'));
    await rightFromKeyboard();
    expect(getCurrentFocusKey()).toBe(key('g'));
  });

  it('returns to the key last used from the first column of every block', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Title 1');
    await rightFromKeyboard('n');
    await focusKeyIs(boxSetCard('bs-1'));
    await pressKey(KEY.left);
    await focusKeyIs(key('n'));

    await focusOn(personCard('pers-1'));
    await pressKey(KEY.left);
    await focusKeyIs(key('n'));

    await focusOn(titleCard('title-1'));
    await pressKey(KEY.left);
    await focusKeyIs(key('n'));

    await focusOn(pill('all'));
    await pressKey(KEY.left);
    await focusKeyIs(key('n'));
  });

  it('moves inside a row and the grid before it leaves them', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Title 1');
    await focusOn(boxSetCard('bs-1'));
    await pressKey(KEY.right);
    await focusKeyIs(boxSetCard('bs-2'));
    await pressKey(KEY.left);
    await focusKeyIs(boxSetCard('bs-1'));

    await focusOn(titleCard('title-2'));
    await pressKey(KEY.left);
    await focusKeyIs(titleCard('title-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs(titleCard('title-4'));
    // The right edge of the grid is an edge.
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(titleCard('title-4'));
    await pressKey(KEY.down);
    await focusKeyIs(titleCard('title-6'));
  });

  it('moves down and up through the blocks: segments, box sets, people, titles', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Title 1');
    await focusOn(pill('all'));
    await pressKey(KEY.down);
    await focusKeyIs(boxSetCard('bs-1'));
    await pressKey(KEY.down);
    await focusKeyIs(personCard('pers-1'));
    await pressKey(KEY.down);
    await focusKeyIs(titleCard('title-1'));
    await pressKey(KEY.up);
    await focusKeyIs(personCard('pers-1'));
    await pressKey(KEY.up);
    await focusKeyIs(boxSetCard('bs-1'));
    await pressKey(KEY.up);
    await focusKeyIs(pill('all'));
  });

  it('skips the blocks that are not there', async () => {
    setup({ capabilities: {}, titles: () => matches('Title', 3) });
    type('sag');
    await found('Title 1');
    await focusOn(pill('all'));
    await pressKey(KEY.down);
    await focusKeyIs(titleCard('title-1'));
    await pressKey(KEY.up);
    await focusKeyIs(pill('all'));
  });

  it('lets the box sets and people make way while the focus is in the titles', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Title 1');
    const page = screen.getByTestId('search-page');
    expect(page.style.transform).toBe('translateY(0px)');
    await focusOn(titleCard('title-1'));
    await waitFor(() =>
      expect(page.style.transform).toBe(
        `translateY(-${rowHeight('poster') + rowHeight('person')}px)`,
      ),
    );
    await focusOn(boxSetCard('bs-1'));
    await waitFor(() => expect(page.style.transform).toBe('translateY(0px)'));
  });

  it("tells the shell's top bar that the page has moved up, though the grid itself is at its first row", async () => {
    const barStore = new BarAwayStore();
    setup({ ...FULL, barStore });
    type('sag');
    await found('Title 1');
    expect(barStore.isAway()).toBe(false);
    // Six titles are one grid row: the grid is not scrolled, only the page above it is.
    await focusOn(titleCard('title-1'));
    await waitFor(() => expect(barStore.isAway()).toBe(true));
    await focusOn(boxSetCard('bs-1'));
    await waitFor(() => expect(barStore.isAway()).toBe(false));
  });

  describe('and the pointer', () => {
    const gridOffset = `translateY(-${rowHeight('poster') + rowHeight('person')}px)`;

    it('keeps the page at the top for a hovered title; the next key inside the grid scrolls it (inGrid)', async () => {
      setup({ ...FULL });
      type('sag');
      await found('Title 1');
      const page = screen.getByTestId('search-page');
      expect(page.style.transform).toBe('translateY(0px)');
      fireEvent.mouseMove(document.querySelector(`[data-focus-key="${titleCard('title-1')}"]`)!);
      await focusKeyIs(titleCard('title-1'));
      await act(async () => {});
      expect(page.style.transform).toBe('translateY(0px)');
      await pressKey(KEY.right);
      await focusKeyIs(titleCard('title-2'));
      await waitFor(() => expect(page.style.transform).toBe(gridOffset));
    });

    it('keeps the page scrolled for a hovered keyboard key; the next key on the keyboard moves it back (keyFocused)', async () => {
      setup({ ...FULL });
      type('sag');
      await found('Title 1');
      const page = screen.getByTestId('search-page');
      await focusOn(titleCard('title-1'));
      await waitFor(() => expect(page.style.transform).toBe(gridOffset));
      fireEvent.mouseMove(screen.getByTestId('osk-b'));
      await focusKeyIs(key('b'));
      await act(async () => {});
      expect(page.style.transform).toBe(gridOffset);
      await pressKey(KEY.right);
      await focusKeyIs(key('c'));
      await waitFor(() => expect(page.style.transform).toBe('translateY(0px)'));
    });

    it('keeps the page scrolled for a hovered segment pill; the next key onto another pill moves it back (inTop)', async () => {
      setup({ ...FULL });
      type('sag');
      await found('Title 1');
      const page = screen.getByTestId('search-page');
      await focusOn(titleCard('title-1'));
      await waitFor(() => expect(page.style.transform).toBe(gridOffset));
      fireEvent.mouseMove(document.querySelector(`[data-focus-key="${pill('all')}"]`)!);
      await focusKeyIs(pill('all'));
      await act(async () => {});
      expect(page.style.transform).toBe(gridOffset);
      await pressKey(KEY.right);
      expect(getCurrentFocusKey()).not.toBe(pill('all'));
      await waitFor(() => expect(page.style.transform).toBe('translateY(0px)'));
    });
  });

  it('puts the focus back on the keyboard when the results it is in turn empty', async () => {
    setup({
      capabilities: {},
      titles: (q) => (q.get('q') === 'sag' ? matches('Title', 3) : []),
    });
    type('sag');
    await found('Title 1');
    await focusOn(titleCard('title-2'));
    fireEvent.click(screen.getByTestId('osk-delete'));
    await screen.findByTestId('search-empty');
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
  });

  it('does the same for a box set or a person that disappears', async () => {
    setup({
      ...FULL,
      titles: (q) => (q.get('q') === 'sag' ? matches('Title', 3) : []),
      boxSets: (q) => (q.get('q') === 'sag' ? FULL.boxSets!(q) : []),
      people: (q) => (q.get('q') === 'sag' ? FULL.people!(q) : []),
    });
    type('sag');
    await found('Title 1');
    await focusOn(boxSetCard('bs-2'));
    fireEvent.click(screen.getByTestId('osk-delete'));
    await screen.findByTestId('search-empty');
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
  });

  it('leaves the focus alone when results turn empty while it is on a segment', async () => {
    setup({
      capabilities: {},
      titles: (q) => (q.get('type') === 'series' ? [] : matches('Title', 3)),
    });
    type('sag');
    await found('Title 1');
    await focusOn(pill('series'));
    await pressKey(KEY.enter);
    await screen.findByTestId('search-empty');
    await sleep(50);
    expect(getCurrentFocusKey()).toBe(pill('series'));
  });

  it('answers Back from the results by moving to the keyboard, and leaves it to the shell on the keyboard', async () => {
    const { onShellBack } = setup({ ...FULL });
    type('sag');
    await found('Title 1');
    await focusOn(titleCard('title-3'));
    await pressKey(KEY.back);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
    expect(onShellBack).not.toHaveBeenCalled();
    await focusOn(pill('movies'));
    await pressKey(KEY.back);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
    expect(onShellBack).not.toHaveBeenCalled();
    await pressKey(KEY.back);
    expect(onShellBack).toHaveBeenCalledTimes(1);
  });
});

describe('SearchScreen: opening a result', () => {
  const opened = (id: string) => JSON.parse(screen.getByTestId(id).textContent ?? '{}') as object;

  it('opens a movie or series on its detail page', async () => {
    setup({
      capabilities: {},
      titles: () => [
        ...matches('Film', 1),
        ...matches('Show', 1).map((m) => ({ ...m, type: 'series' })),
      ],
    });
    type('sag');
    await found('Film 1');
    await focusOn(titleCard('film-1'));
    await pressKey(KEY.enter);
    expect(opened('detail-stub')).toEqual({ name: 'detail', itemId: 'film-1' });
    await pressKey(KEY.back);
    await found('Show 1');
    await focusOn(titleCard('show-1'));
    await pressKey(KEY.enter);
    expect(opened('detail-stub')).toEqual({ name: 'detail', itemId: 'show-1' });
  });

  it('plays a title result from where it left off on the Play key, without opening its page', async () => {
    const { onPlay } = setup({ capabilities: {}, titles: () => matches('Film', 2) });
    type('sag');
    await found('Film 1');
    await focusOn(titleCard('film-2'));
    await pressPlayKey();
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ content_id: 'film-2' }),
      { kind: 'resume' },
    );
    expect(screen.queryByTestId('detail-stub')).toBeNull();
  });

  it('opens an episode on its own page', async () => {
    setup({ capabilities: { video_with_episodes_scope: true }, titles: () => [episodeMatch()] });
    type('sag');
    await found('Sagas of Old');
    await focusOn(titleCard('ep-1'));
    await pressKey(KEY.enter);
    expect(opened('detail-stub')).toEqual({ name: 'detail', itemId: 'ep-1' });
  });

  it('opens a box set on its page with its library', async () => {
    setup({
      ...FULL,
      boxSets: () => [
        boxSetSummary({
          id: 'bs-9',
          library_id: 'lib-7',
          title: 'Nine Box Set',
          backdrop_url: '/img/nine.webp',
        }),
      ],
    });
    type('sag');
    await found('Nine Box Set');
    await focusOn(boxSetCard('bs-9'));
    await pressKey(KEY.enter);
    expect(opened('boxset-stub')).toEqual({
      name: 'boxSet',
      boxSetId: 'bs-9',
      libraryId: 'lib-7',
      boxSetTitle: 'Nine Box Set',
      backdropUrl: '/img/nine.webp',
    });
  });

  it('opens a person on their page', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Sage Two');
    await focusOn(personCard('pers-2'));
    await pressKey(KEY.enter);
    expect(opened('person-stub')).toEqual({
      name: 'person',
      personId: 'pers-2',
      personName: 'Sage Two',
    });
  });
});

describe('SearchScreen: coming back from a page', () => {
  it('restores the text, the segment, the results and the focused title', async () => {
    const memory = new SearchMemory();
    const { calls } = setup({ ...FULL, memory, titles: () => matches('Title', 12) });
    type('sag');
    await found('Title 1');
    await focusOn(pill('movies'));
    await pressKey(KEY.enter);
    await found('Title 1');
    await focusOn(titleCard('title-6'));
    await pressKey(KEY.enter);
    await screen.findByTestId('detail-stub');
    expect(screen.queryByTestId('search')).toBeNull();

    const before = calls.titles.length;
    await pressKey(KEY.back);
    await screen.findByTestId('search');
    // The text and the segment are there at once, without a new keystroke.
    expect(screen.getByTestId('search-text')).toHaveTextContent('sag');
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute('aria-selected', 'true');
    await focusKeyIs(titleCard('title-6'));
    expect(calls.titles.length).toBeGreaterThanOrEqual(before);
    expect(lastTitleRead(calls).get('type')).toBe('movie');
  });

  it('restores the focused box set and the focused person', async () => {
    setup({ ...FULL });
    type('sag');
    await found('Other Saga Box Set');
    await focusOn(boxSetCard('bs-2'));
    await pressKey(KEY.enter);
    await screen.findByTestId('boxset-stub');
    await pressKey(KEY.back);
    await focusKeyIs(boxSetCard('bs-2'));

    await focusOn(personCard('pers-2'));
    await pressKey(KEY.enter);
    await screen.findByTestId('person-stub');
    await pressKey(KEY.back);
    await focusKeyIs(personCard('pers-2'));
  });

  it('shows the cached results at once when the cache still has them', async () => {
    const { calls } = setup({ ...FULL, queryClient: keepingClient() });
    type('sag');
    await found('Title 1');
    await focusOn(titleCard('title-3'));
    await pressKey(KEY.enter);
    await screen.findByTestId('detail-stub');
    const reads = calls.titles.length;
    await pressKey(KEY.back);
    expect(await found('Title 3')).toBeInTheDocument();
    await focusKeyIs(titleCard('title-3'));
    expect(calls.titles.length).toBe(reads);
  });

  it('restores a title deep in the grid, with the grid scrolled to its row', async () => {
    setup({ capabilities: {}, titles: () => matches('Title', 60) });
    type('sag');
    await found('Title 1');
    await focusOn(titleCard('title-1'));
    for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
    await focusKeyIs(titleCard('title-25'));
    await pressKey(KEY.enter);
    await screen.findByTestId('detail-stub');
    await pressKey(KEY.back);
    await focusKeyIs(titleCard('title-25'));
    expect(screen.getByTestId('grid-track').style.transform).toBe(
      `translateY(-${6 * SEARCH_GRID.rowPitch}px)`,
    );
  });

  it('restores the last box set of the row', async () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      boxSetSummary({ id: `bs-${i + 1}`, title: `Saga ${i + 1} Box Set` }),
    );
    setup({ ...FULL, boxSets: () => many });
    type('sag');
    await found('Saga 4 Box Set');
    await focusOn(boxSetCard('bs-1'));
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.right);
    await focusKeyIs(boxSetCard('bs-4'));
    await pressKey(KEY.enter);
    await screen.findByTestId('boxset-stub');
    await pressKey(KEY.back);
    await focusKeyIs(boxSetCard('bs-4'));
  });

  it('restores a person beyond the cards that fit the row', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      personMatch({ id: `pers-${i + 1}`, name: `Sage ${i + 1}` }),
    );
    setup({ ...FULL, people: () => many });
    type('sag');
    await found('Sage 1');
    await focusOn(personCard('pers-1'));
    for (let i = 0; i < 10; i += 1) await pressKey(KEY.right);
    await focusKeyIs(personCard('pers-11'));
    await pressKey(KEY.enter);
    await screen.findByTestId('person-stub');
    await pressKey(KEY.back);
    await focusKeyIs(personCard('pers-11'));
  });
});
