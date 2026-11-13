import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { BASE_URL, account } from '../../test/apiFixtures';
import { library } from '../../test/flowFixtures';
import {
  facets,
  serveLibrary,
  titles,
  type LibraryCalls,
  type LibraryServe,
} from '../../test/libraryFixtures';
import { KEY, pressKey } from '../../test/keys';
import { expectPlayedFromCard, pressPlayKey } from '../../test/playKey';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { gridCardKey, GRID_ROW_PITCH } from '../../ui/media';
import { DEFAULT_BROWSE } from './browse';
import { LibraryScreen } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const GRID = 'browse:lib-1:movie';
const card = (id: string) => gridCardKey(GRID, id);

function setup(memory = new LibraryMemory()) {
  memory.selectView('movie', 'browse');
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const onOpenDetail = vi.fn();
  const onPlay = vi.fn();
  const view = renderWithSilo(
    <LibraryScreen
      kind="movie"
      memory={memory}
      onPlay={onPlay}
      onOpenDetail={onOpenDetail}
      onExploreSection={vi.fn()}
      onOpenCollection={vi.fn()}
    />,
    { session },
  );
  return { memory, onOpenDetail, onPlay, ...view };
}

async function focus(key: string) {
  await act(async () => {
    await setFocus(key);
  });
  await waitFor(() => expect(getCurrentFocusKey()).toBe(key));
}

/** The browse reads so far, after the first one arrived. */
async function firstRead(calls: LibraryCalls) {
  await waitFor(() => expect(calls.browse.length).toBeGreaterThan(0));
  return calls.browse[0]!;
}
const lastRead = (calls: LibraryCalls) => calls.browse[calls.browse.length - 1]!;
const groupsOf = (query: URLSearchParams) =>
  JSON.parse(query.get('groups') ?? 'null') as
    { match: string; rules: { field: string; op: string; value: unknown }[] }[] | null;

/** A poster is in the grid (the grid mounts only the rows near the focus). */
const posterShown = (id: string) =>
  waitFor(() => expect(document.querySelector(`[data-focus-key="${card(id)}"]`)).not.toBeNull());

const sortPill = () => screen.getByRole('button', { name: /^Sort/ });
const filterPill = () => screen.getByRole('button', { name: /^Filter/ });
const letter = (name: string) =>
  document.querySelector<HTMLButtonElement>(`[data-letter="${name}"]`)!;

describe('Browse', () => {
  it('reads the library with its kind, the title sort and the grid poster width', async () => {
    const calls = serveLibrary(server);
    setup();
    const query = await firstRead(calls);
    expect(query.get('library_id')).toBe('lib-1');
    expect(query.get('type')).toBe('movie');
    expect(query.get('sort')).toBe('title');
    expect(query.get('match')).toBe('all');
    expect(query.get('limit')).toBe('40');
    expect(query.get('poster_width')).toBe('520');
    for (const absent of ['groups', 'name_prefix', 'cursor']) expect(query.has(absent)).toBe(false);
    await screen.findByRole('button', { name: /Title 3/ });
    expect(sortPill()).toHaveTextContent('Sort · Title');
  });

  it('shows a grid skeleton while the first page loads', async () => {
    serveLibrary(server, {
      browse: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return {
          items: titles('Title', 3),
          total: 3,
          total_exact: true,
          window_cursor: 'c',
        };
      },
    });
    setup();
    expect(await screen.findByTestId('grid-skeleton')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('grid-skeleton')).toBeNull());
  });

  it('opens a poster through the item opener', async () => {
    const calls = serveLibrary(server);
    const { onOpenDetail } = setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus(card('Title2'));
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'Title2' });
  });

  it('plays a poster from where it left off on the Play key, without opening its page', async () => {
    const calls = serveLibrary(server);
    const { onOpenDetail, onPlay } = setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus(card('Title2'));
    await pressPlayKey();
    expectPlayedFromCard(onPlay, onOpenDetail, 'Title2');
  });

  it('follows the cursor when the focus nears the end, and stops at the last page', async () => {
    const pages: (string | null)[] = [];
    const calls = serveLibrary(server, {
      browse: (query) => {
        const cursor = query.get('cursor');
        pages.push(cursor);
        if (cursor === null) {
          return {
            items: titles('Title', 40),
            total: 50,
            total_exact: true,
            window_cursor: 'w',
            page: { has_more: true, next_cursor: 'c2' },
          };
        }
        return {
          items: titles('Title', 10, 'movie', 40),
          total: 50,
          total_exact: true,
          window_cursor: 'w',
          page: { has_more: false },
        };
      },
    });
    setup();
    await firstRead(calls);
    await posterShown('Title3');
    // Early in the list nothing more is asked for.
    expect(pages).toEqual([null]);
    // Eighteen cards (three rows) from the end of the 40: the next page.
    await focus(card('Title23'));
    await waitFor(() => expect(pages).toEqual([null, 'c2']));
    // The second read keeps the sort of the first.
    expect(lastRead(calls).get('sort')).toBe('title');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(pages).toHaveLength(2);
  });

  it('shows an error with Try again, and recovers', async () => {
    let fail = true;
    const calls = serveLibrary(server, {
      browse: () =>
        fail
          ? new HttpResponse(null, { status: 500 })
          : {
              items: titles('Title', 3),
              total: 3,
              total_exact: true,
              window_cursor: 'c',
            },
    });
    setup();
    expect(await screen.findByTestId('browse-error')).toBeInTheDocument();
    fail = false;
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    await screen.findByRole('button', { name: /Title 2/ });
    expect(calls.browse.length).toBeGreaterThanOrEqual(2);
  });

  it('says so when the library has no titles, and when the filters match none', async () => {
    serveLibrary(server, {
      browse: () => ({ items: [], total: 0, total_exact: true, window_cursor: 'c' }),
    });
    setup();
    expect(await screen.findByTestId('browse-empty')).toHaveTextContent(
      'This library has no titles yet.',
    );
  });

  it('says that no titles match when filters are set and the answer is empty', async () => {
    serveLibrary(server, {
      browse: () => ({ items: [], total: 0, total_exact: true, window_cursor: 'c' }),
    });
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'title',
      descending: false,
      filters: { genre: ['Action'] },
    });
    setup(memory);
    expect(await screen.findByTestId('browse-empty')).toHaveTextContent(
      'No titles match these filters.',
    );
  });
});

describe('Browse sort', () => {
  it('lists the sorts with the current one marked, and a choice changes the request', async () => {
    const calls = serveLibrary(server);
    setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    const list = await screen.findByTestId('sort-list');
    const options = within(list).getAllByRole('menuitemradio');
    expect(options.map((o) => o.querySelector('span')?.textContent)).toEqual([
      'Title',
      'Date added',
      'Release date',
      'Year',
      'Rating',
      'Runtime',
    ]);
    // Title is current, ascending; the focus starts on it.
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options.filter((o) => o.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(within(list).getByTestId('sort-current')).toHaveTextContent('↑ ascending');
    await waitFor(() => expect(options[0]).toHaveFocus());
    // Year: a new sort starts with the newest.
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(options[3]).toHaveFocus();
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('sort-list')).toBeNull());
    await waitFor(() => expect(lastRead(calls).get('sort')).toBe('-year'));
    expect(sortPill()).toHaveTextContent('Sort · Year');
    // The list closed onto the Sort pill.
    await waitFor(() => expect(sortPill()).toHaveFocus());
  });

  it('marks the direction of the current sort, and choosing it again reverses it', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'year',
      descending: true,
      filters: {},
    });
    setup(memory);
    await firstRead(calls);
    expect(calls.browse[0]!.get('sort')).toBe('-year');
    await screen.findByRole('button', { name: /Title 2/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    const list = await screen.findByTestId('sort-list');
    expect(within(list).getByTestId('sort-current')).toHaveTextContent('↓ descending');
    // The focus starts on the current sort; OK reverses it.
    await waitFor(() => expect(within(list).getAllByRole('menuitemradio')[3]).toHaveFocus());
    await pressKey(KEY.enter);
    await waitFor(() => expect(lastRead(calls).get('sort')).toBe('year'));
    expect(memory.browseOf('movie', 'lib-1').descending).toBe(false);
  });

  it('keeps the arrow keys inside the list', async () => {
    const calls = serveLibrary(server);
    setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    await screen.findByTestId('sort-list');
    // The arrow keys cannot leave the list.
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    expect(screen.getByTestId('sort-list')).toContainElement(document.activeElement as HTMLElement);
  });
});

describe('Browse filter', () => {
  async function openFilter(calls: LibraryCalls) {
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus('browse-filter');
    await pressKey(KEY.enter);
    return screen.findByTestId('filter-panel');
  }
  const row = (panel: HTMLElement, name: RegExp) => within(panel).getByRole('button', { name });

  it('asks the server which facets the library has, with its kind', async () => {
    const calls = serveLibrary(server);
    setup();
    await firstRead(calls);
    await waitFor(() => expect(calls.filters).toHaveLength(1));
    expect(calls.filters[0]!.get('library_id')).toBe('lib-1');
    expect(calls.filters[0]!.get('type')).toBe('movie');
  });

  it('moves the focus to the first facet when the facets arrive after the panel opened', async () => {
    const calls = serveLibrary(server);
    // The facets come late (a slow link or TV): the panel opens without its genres.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/filters`, async () => {
        await gate;
        return HttpResponse.json(facets());
      }),
    );
    setup();
    const panel = await openFilter(calls);
    // Without genres the panel landed on a later row (Done, or Status once the probe is back).
    await waitFor(() => expect(getCurrentFocusKey()?.startsWith('lib-dialog-')).toBe(true));
    expect(getCurrentFocusKey()).not.toBe('lib-dialog-facet-genre');
    release();
    await waitFor(() => expect(row(panel, /^Genre/)).toBeInTheDocument());
    await waitFor(() => expect(getCurrentFocusKey()).toBe('lib-dialog-facet-genre'));
  });

  it('lists the facets the server has values for, and leaves out the rest', async () => {
    const calls = serveLibrary(server, { filters: facets({ genres: [] }) });
    setup();
    const panel = await openFilter(calls);
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: /Decade/ })).toBeInTheDocument(),
    );
    expect(
      within(panel)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['DecadeAny ›', 'StatusAll ›', 'Content ratingAny ›', 'Clear filters', 'Done']);
  });

  it('lists genre, decade, status and content rating, and nothing else, when the server has extended rules', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await waitFor(() => expect(calls.capabilities).toBeGreaterThan(0));
    await waitFor(() =>
      expect(
        within(panel)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual([
        'GenreAny ›',
        'DecadeAny ›',
        'StatusAll ›',
        'Content ratingAny ›',
        'Clear filters',
        'Done',
      ]),
    );
    // Nothing is set, so there is nothing to clear.
    expect(row(panel, /Clear filters/)).toBeDisabled();
  });

  it('leaves the decade out when the server does not advertise extended rules', async () => {
    const calls = serveLibrary(server, { extendedRules: false });
    setup();
    const panel = await openFilter(calls);
    await waitFor(() => expect(calls.capabilities).toBeGreaterThan(0));
    await within(panel).findByRole('button', { name: /Genre/ });
    expect(within(panel).queryByRole('button', { name: /Decade/ })).toBeNull();
    expect(
      within(panel)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['GenreAny ›', 'StatusAll ›', 'Content ratingAny ›', 'Clear filters', 'Done']);
  });

  it('leaves the decade out when the capabilities cannot be read', async () => {
    const calls = serveLibrary(server, { extendedRules: 'fail' });
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Genre/ });
    await waitFor(() => expect(calls.capabilities).toBeGreaterThan(0));
    expect(within(panel).queryByRole('button', { name: /Decade/ })).toBeNull();
  });

  it('selects several values of a facet, applies them on Done and counts them on the pill', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Genre/ });
    await focus('lib-dialog-facet-genre');
    await pressKey(KEY.enter);
    const values = await within(panel).findByTestId('facet-values');
    const action = within(values).getByRole('menuitemcheckbox', { name: /Action/ });
    const drama = within(values).getByRole('menuitemcheckbox', { name: /Drama/ });
    await waitFor(() => expect(action).toHaveFocus());
    await pressKey(KEY.enter);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(action).toHaveAttribute('aria-checked', 'true');
    expect(drama).toHaveAttribute('aria-checked', 'true');
    expect(within(values).getByRole('menuitemcheckbox', { name: /Sci-Fi/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Nothing is sent while the panel is open.
    expect(calls.browse).toHaveLength(1);
  });

  it('sends the chosen filters once, as groups of any-matching rules that all have to match', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Genre/ });
    await focus('lib-dialog-facet-genre');
    await pressKey(KEY.enter);
    await within(panel).findByTestId('facet-values');
    await waitFor(() =>
      expect(within(panel).getByRole('menuitemcheckbox', { name: /Action/ })).toHaveFocus(),
    );
    await pressKey(KEY.enter);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    // Back to the list through the "All filters" row, which is above the values.
    await focus('lib-dialog-all');
    await pressKey(KEY.enter);
    await waitFor(() =>
      expect(within(panel).getByTestId('facet-summary-genre')).toHaveTextContent('2 selected ›'),
    );
    // The decade, one value.
    await focus('lib-dialog-facet-decade');
    await pressKey(KEY.enter);
    await within(panel).findByTestId('facet-values');
    await focus('lib-dialog-value-decade-1990');
    await pressKey(KEY.enter);
    await focus('lib-dialog-all');
    await pressKey(KEY.enter);
    expect(calls.browse).toHaveLength(1);
    await focus('lib-dialog-done');
    await pressKey(KEY.enter);
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    const query = lastRead(calls);
    expect(query.get('match')).toBe('all');
    expect(groupsOf(query)).toEqual([
      {
        match: 'any',
        rules: [
          { field: 'genre', op: 'contains', value: 'Action' },
          { field: 'genre', op: 'contains', value: 'Drama' },
        ],
      },
      { match: 'any', rules: [{ field: 'decade', op: 'is', value: 1990 }] },
    ]);
    // The pill counts facets, not values, and the panel closed onto it.
    await waitFor(() => expect(screen.queryByTestId('filter-panel')).toBeNull());
    expect(screen.getByTestId('filter-count')).toHaveTextContent('2');
    await waitFor(() => expect(filterPill()).toHaveFocus());
  });

  it('clears every filter, and the pill loses its count', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'title',
      descending: false,
      filters: { genre: ['Action'], decade: ['1990'] },
    });
    setup(memory);
    await firstRead(calls);
    expect(groupsOf(calls.browse[0]!)).toHaveLength(2);
    await screen.findByRole('button', { name: /Title 2/ });
    expect(screen.getByTestId('filter-count')).toHaveTextContent('2');
    await focus('browse-filter');
    await pressKey(KEY.enter);
    const panel = await screen.findByTestId('filter-panel');
    // The panel starts from what is set.
    await waitFor(() =>
      expect(within(panel).getByTestId('facet-summary-genre')).toHaveTextContent('Action ›'),
    );
    await focus('lib-dialog-clear');
    await pressKey(KEY.enter);
    await waitFor(() => expect(row(panel, /Clear filters/)).toBeDisabled());
    // Clearing moves the focus on to Done.
    await waitFor(() => expect(getCurrentFocusKey()).toBe('lib-dialog-done'));
    await pressKey(KEY.enter);
    await waitFor(() => expect(lastRead(calls).has('groups')).toBe(false));
    await waitFor(() => expect(screen.queryByTestId('filter-count')).toBeNull());
    expect(memory.browseOf('movie', 'lib-1').filters).toEqual({});
  });

  /** Opens the content-rating section, checks the given values and returns to the list. */
  async function pickRatings(panel: HTMLElement, values: string[]) {
    await within(panel).findByRole('button', { name: /Content rating/ });
    await focus('lib-dialog-facet-content_rating');
    await pressKey(KEY.enter);
    await within(panel).findByTestId('facet-values');
    for (const value of values) {
      await focus(`lib-dialog-value-content_rating-${value}`);
      await pressKey(KEY.enter);
    }
    await focus('lib-dialog-all');
    await pressKey(KEY.enter);
  }
  async function applyPanel() {
    await focus('lib-dialog-done');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('filter-panel')).toBeNull());
  }

  it('offers the content ratings the server reports for the library', async () => {
    const calls = serveLibrary(server, {
      filters: facets({ content_ratings: ['FSK 12', 'FSK 16'] }),
    });
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Content rating/ });
    await focus('lib-dialog-facet-content_rating');
    await pressKey(KEY.enter);
    const values = await within(panel).findByTestId('facet-values');
    expect(
      within(values)
        .getAllByRole('menuitemcheckbox')
        .map((b) => b.textContent),
    ).toEqual(['FSK 12', 'FSK 16']);
  });

  it('leaves the content rating out when the server reports none', async () => {
    const calls = serveLibrary(server, { filters: facets({ content_ratings: [] }) });
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Genre/ });
    expect(within(panel).queryByRole('button', { name: /Content rating/ })).toBeNull();
  });

  it('sends the chosen content ratings as repeated content_rating parameters, not as rules', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await pickRatings(panel, ['PG', 'R']);
    await waitFor(() =>
      expect(within(panel).getByTestId('facet-summary-content_rating')).toHaveTextContent(
        '2 selected ›',
      ),
    );
    expect(calls.browse).toHaveLength(1);
    await applyPanel();
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    const query = lastRead(calls);
    expect(query.getAll('content_rating')).toEqual(['PG', 'R']);
    expect(query.has('groups')).toBe(false);
    expect(screen.getByTestId('filter-count')).toHaveTextContent('1');
  });

  it('combines the content rating with sort, genre, decade and paging', async () => {
    const calls = serveLibrary(server, {
      browse: (query) => ({
        items: titles('Title', 3, 'movie', query.get('cursor') ? 3 : 0),
        total: 3,
        total_exact: true,
        window_cursor: 'w',
        page: query.get('cursor') ? { has_more: false } : { has_more: true, next_cursor: 'c2' },
      }),
    });
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'year',
      descending: true,
      filters: { genre: ['Action'], decade: ['1990'], content_rating: ['PG'] },
    });
    setup(memory);
    const query = await firstRead(calls);
    expect(query.get('sort')).toBe('-year');
    expect(query.has('name_prefix')).toBe(false);
    expect(query.getAll('content_rating')).toEqual(['PG']);
    expect(groupsOf(query)!.map((g) => g.rules[0]!.field)).toEqual(['genre', 'decade']);
    await screen.findByRole('button', { name: /Title 2/ });
    // The next page keeps every one of them.
    await focus(card('Title2'));
    await waitFor(() => expect(calls.browse.length).toBeGreaterThan(1));
    const next = lastRead(calls);
    expect(next.get('cursor')).toBe('c2');
    expect(next.getAll('content_rating')).toEqual(['PG']);
    expect(next.get('sort')).toBe('-year');
    expect(screen.getByTestId('filter-count')).toHaveTextContent('3');
  });

  it('clears the content rating with the other filters', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'title',
      descending: false,
      filters: { content_rating: ['R'] },
    });
    setup(memory);
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    expect(lastRead(calls).getAll('content_rating')).toEqual(['R']);
    await focus('browse-filter');
    await pressKey(KEY.enter);
    const panel = await screen.findByTestId('filter-panel');
    await waitFor(() =>
      expect(within(panel).getByTestId('facet-summary-content_rating')).toHaveTextContent('R ›'),
    );
    await focus('lib-dialog-clear');
    await pressKey(KEY.enter);
    await applyPanel();
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    expect(lastRead(calls).has('content_rating')).toBe(false);
    expect(memory.browseOf('movie', 'lib-1').filters).toEqual({});
    await waitFor(() => expect(screen.queryByTestId('filter-count')).toBeNull());
  });

  it('is restored with the next visit of the library, like the other filters', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    const first = setup(memory);
    const panel = await openFilter(calls);
    await pickRatings(panel, ['PG']);
    await applyPanel();
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    first.unmount();
    calls.browse.length = 0;
    setup(memory);
    const query = await firstRead(calls);
    expect(query.getAll('content_rating')).toEqual(['PG']);
    await waitFor(() => expect(screen.getByTestId('filter-count')).toHaveTextContent('1'));
  });

  /** Opens the Status section, picks one choice (or "none" for All) and returns to the list. */
  async function pickStatus(panel: HTMLElement, value: string) {
    await within(panel).findByRole('button', { name: /^Status/ });
    await focus('lib-dialog-facet-status');
    await pressKey(KEY.enter);
    await within(panel).findByTestId('facet-values');
    await focus(`lib-dialog-value-status-${value}`);
    await pressKey(KEY.enter);
    await focus('lib-dialog-all');
    await pressKey(KEY.enter);
  }
  const ruleOf = (query: URLSearchParams) => groupsOf(query)!.map((g) => g.rules);

  it('probes the watch rules with a one-title read under "watched is false", and then offers Status', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /^Status/ });
    expect(calls.probes).toHaveLength(1);
    const probe = calls.probes[0]!;
    expect(probe.get('library_id')).toBe('lib-1');
    expect(probe.get('limit')).toBe('1');
    expect(ruleOf(probe)).toEqual([[{ field: 'watched', op: 'is', value: false }]]);
    // The probe is no browse read.
    expect(calls.browse.every((q) => q.get('limit') !== '1')).toBe(true);
  });

  it('leaves Status out without any message when the server answers the probe with 422', async () => {
    const calls = serveLibrary(server, { watchRules: false });
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Genre/ });
    await waitFor(() => expect(calls.probes).toHaveLength(1));
    expect(within(panel).queryByRole('button', { name: /^Status/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('browse-error')).toBeNull();
    expect(
      within(panel)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['GenreAny ›', 'DecadeAny ›', 'Content ratingAny ›', 'Clear filters', 'Done']);
  });

  it('leaves Status out when the probe fails for any other reason', async () => {
    const calls = serveLibrary(server, { watchRules: 'fail' });
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /Genre/ });
    await waitFor(() => expect(calls.probes).toHaveLength(1));
    expect(within(panel).queryByRole('button', { name: /^Status/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('probes once for the session, not whenever the panel opens', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await within(panel).findByRole('button', { name: /^Status/ });
    await applyPanel();
    await focus('browse-filter');
    await pressKey(KEY.enter);
    const again = await screen.findByTestId('filter-panel');
    await within(again).findByRole('button', { name: /^Status/ });
    expect(calls.probes).toHaveLength(1);
  });

  it('writes each watch-state choice as its rule group, one at a time, and "All" as none', async () => {
    const calls = serveLibrary(server);
    setup();
    let current = await openFilter(calls);
    const expected: [string, unknown][] = [
      ['unwatched', { field: 'watched', op: 'is', value: false }],
      ['watched', { field: 'watched', op: 'is', value: true }],
      ['in_progress', { field: 'in_progress', op: 'is', value: true }],
    ];
    let reads = 1;
    for (const [value, rule] of expected) {
      await pickStatus(current, value);
      await applyPanel();
      reads += 1;
      await waitFor(() => expect(calls.browse).toHaveLength(reads));
      expect(ruleOf(lastRead(calls))).toEqual([[rule]]);
      await focus('browse-filter');
      await pressKey(KEY.enter);
      current = await screen.findByTestId('filter-panel');
      // One choice at a time: only the picked one is checked.
      await focus('lib-dialog-facet-status');
      await pressKey(KEY.enter);
      const values = await within(current).findByTestId('facet-values');
      const checked = within(values)
        .getAllByRole('menuitemradio')
        .filter((r) => r.getAttribute('aria-checked') === 'true');
      expect(checked).toHaveLength(1);
      await focus('lib-dialog-all');
      await pressKey(KEY.enter);
    }
    // "All" takes the choice away again.
    await pickStatus(current, 'none');
    await applyPanel();
    await waitFor(() => expect(lastRead(calls).has('groups')).toBe(false));
    expect(screen.queryByTestId('filter-count')).toBeNull();
  });

  it('combines the watch state with sort, genre, decade, rating and paging', async () => {
    const calls = serveLibrary(server, {
      browse: (query) => ({
        items: titles('Title', 3, 'movie', query.get('cursor') ? 3 : 0),
        total: 6,
        total_exact: true,
        window_cursor: 'w',
        page: query.get('cursor') ? { has_more: false } : { has_more: true, next_cursor: 'c2' },
      }),
    });
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'year',
      descending: true,
      filters: {
        genre: ['Action'],
        decade: ['1990'],
        status: ['in_progress'],
        content_rating: ['PG'],
      },
    });
    setup(memory);
    const query = await firstRead(calls);
    expect(query.get('sort')).toBe('-year');
    expect(query.getAll('content_rating')).toEqual(['PG']);
    expect(groupsOf(query)!.map((g) => g.rules[0]!.field)).toEqual([
      'genre',
      'decade',
      'in_progress',
    ]);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus(card('Title2'));
    await waitFor(() => expect(calls.browse.length).toBeGreaterThan(1));
    const next = lastRead(calls);
    expect(next.get('cursor')).toBe('c2');
    expect(groupsOf(next)).toEqual(groupsOf(query));
    expect(screen.getByTestId('filter-count')).toHaveTextContent('4');
  });

  it('asks the letter index with the same rule groups as the list', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'title',
      descending: false,
      filters: { genre: ['Action'], status: ['in_progress'] },
    });
    setup(memory);
    await waitFor(() => expect(calls.letters.length).toBeGreaterThan(0));
    const body = calls.letters[calls.letters.length - 1] as {
      groups: { rules: { field: string }[] }[];
    };
    expect(body.groups.map((g) => g.rules[0]!.field)).toEqual(['genre', 'in_progress']);
  });

  it('clears the watch state with the other filters, and restores it with the next visit', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    const first = setup(memory);
    const panel = await openFilter(calls);
    await pickStatus(panel, 'watched');
    await applyPanel();
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('filter-count')).toHaveTextContent('1'));
    first.unmount();
    calls.browse.length = 0;
    setup(memory);
    const query = await firstRead(calls);
    expect(ruleOf(query)).toEqual([[{ field: 'watched', op: 'is', value: true }]]);
    await screen.findByRole('button', { name: /Title 2/ });
    await focus('browse-filter');
    await pressKey(KEY.enter);
    await screen.findByTestId('filter-panel');
    await focus('lib-dialog-clear');
    await pressKey(KEY.enter);
    await applyPanel();
    await waitFor(() => expect(lastRead(calls).has('groups')).toBe(false));
    expect(memory.browseOf('movie', 'lib-1').filters).toEqual({});
  });

  it('sends nothing when the panel is closed without a change', async () => {
    const calls = serveLibrary(server);
    setup();
    await openFilter(calls);
    await focus('lib-dialog-done');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('filter-panel')).toBeNull());
    expect(calls.browse).toHaveLength(1);
  });
});

describe('Browse alphabet rail', () => {
  const letters = (calls: LibraryServe['letters']) => ({ letters: calls });

  /** A letter index with `total` titles in blocks that start at the given positions. */
  const indexOf = (runs: { letter: string; position: number }[], total: number) => ({
    letters: [...new Set(runs.map((run) => run.letter))].map((name) => ({
      letter: name,
      count: 1,
      position: runs.find((run) => run.letter === name)!.position,
    })),
    runs,
    total,
  });

  /** A list of `total` titles in which "Title <n + 1>" sits at position n; seeks are answered by position. */
  const positioned = (total: number) => ({
    browse: (query: URLSearchParams) => {
      const start = Number(query.get('seek') ?? 0);
      return {
        items: titles('Title', Math.min(40, total - start), 'movie', start),
        total,
        total_exact: true,
        window_cursor: 'w',
        page: { has_more: start + 40 < total, next_cursor: 'next' },
      };
    },
  });
  const seeks = (calls: LibraryCalls) =>
    calls.browse.filter((query) => query.has('seek')).map((query) => Number(query.get('seek')));

  const LONG = indexOf(
    [
      { letter: 'A', position: 0 },
      { letter: 'B', position: 200 },
      { letter: 'S', position: 400 },
      { letter: 'T', position: 500 },
    ],
    600,
  );

  async function longList(memory = new LibraryMemory()) {
    const calls = serveLibrary(server, { ...positioned(600), letters: LONG });
    const view = setup(memory);
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    await waitFor(() => expect(letter('S')).not.toBeDisabled());
    return { calls, ...view };
  }

  it('shows # and A to Z, with the letters that have no titles dimmed', async () => {
    const calls = serveLibrary(server, letters(['#', 'A', 'C']));
    setup();
    await firstRead(calls);
    await waitFor(() => expect(letter('B')).toBeDisabled());
    const rail = screen.getByTestId('alpha-rail');
    expect(
      within(rail)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
    expect(letter('A')).not.toBeDisabled();
    expect(letter('C')).not.toBeDisabled();
    for (const dim of ['B', 'D', 'Z']) {
      expect(letter(dim)).toBeDisabled();
      expect(letter(dim)).toHaveClass('dim');
    }
    expect(letter('A')).not.toHaveClass('dim');
  });

  it('asks the letter index about the library, the filters and the title order', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'title',
      descending: true,
      filters: { genre: ['Action'] },
    });
    setup(memory);
    await waitFor(() => expect(calls.letters).toHaveLength(1));
    expect(calls.letters[0]).toEqual({
      library_id: 'lib-1',
      type: 'movie',
      match: 'all',
      groups: [{ match: 'any', rules: [{ field: 'genre', op: 'contains', value: 'Action' }] }],
      order: 'desc',
    });
  });

  it('is not there for another sort order, and the letter index is not read', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', { sort: 'year', descending: true, filters: {} });
    setup(memory);
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    expect(screen.queryByTestId('alpha-rail')).toBeNull();
    expect(calls.letters).toHaveLength(0);
  });

  it('goes away when the sort changes to another order, and comes back with the title order', async () => {
    const calls = serveLibrary(server);
    setup();
    await firstRead(calls);
    await waitFor(() => expect(screen.getByTestId('alpha-rail')).toBeInTheDocument());
    await screen.findByRole('button', { name: /Title 3/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    await screen.findByTestId('sort-list');
    await focus('lib-dialog-sort-year');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('alpha-rail')).toBeNull());
    await screen.findByRole('button', { name: /Title 3/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    await screen.findByTestId('sort-list');
    await focus('lib-dialog-sort-title');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.getByTestId('alpha-rail')).toBeInTheDocument());
  });

  it('is not there when the server cannot give the letter index', async () => {
    const calls = serveLibrary(server, letters('fail'));
    setup();
    await firstRead(calls);
    await waitFor(() => expect(calls.letters).toHaveLength(1));
    await screen.findByRole('button', { name: /Title 3/ });
    expect(screen.queryByTestId('alpha-rail')).toBeNull();
  });

  it('passes over dimmed letters with Up and Down', async () => {
    const calls = serveLibrary(server, letters(['A', 'C', 'E']));
    setup();
    await firstRead(calls);
    await waitFor(() => expect(letter('B')).toBeDisabled());
    await focus('alpha:A');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('alpha:C');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('alpha:E');
    // Nothing usable below E: the focus stays.
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('alpha:E');
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('alpha:C');
  });

  it('does not jump to a letter without titles', async () => {
    const { calls } = await longList();
    expect(letter('C')).toBeDisabled();
    fireEvent.click(letter('C'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seeks(calls)).toEqual([]);
  });

  it('is reached with Right from the last poster of a row, and Left returns to the grid', async () => {
    const calls = serveLibrary(server, { letters: ['A', 'B'] });
    setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 6/ });
    await focus(card('Title6'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()?.startsWith('alpha:')).toBe(true);
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(card('Title6'));
  });

  it('OK on a letter scrolls the grid to its first title, filters nothing, and keeps the focus on the rail', async () => {
    const { calls, memory } = await longList();
    await focus('alpha:S');
    await pressKey(KEY.enter);
    // Position 400 is "Title 401".
    await posterShown('Title401');
    expect(getCurrentFocusKey()).toBe('alpha:S');
    expect(calls.browse.some((query) => query.has('name_prefix'))).toBe(false);
    expect(calls.browse.some((query) => query.has('groups'))).toBe(false);
    // The list stays complete: the grid is as long as the whole list.
    expect(screen.getByTestId('grid-track').style.height).toBe(`${100 * GRID_ROW_PITCH}px`);
    expect(memory.browseOf('movie', 'lib-1')).toEqual(DEFAULT_BROWSE);
    // Another jump works from the same place.
    await focus('alpha:A');
    await pressKey(KEY.enter);
    await posterShown('Title1');
    expect(getCurrentFocusKey()).toBe('alpha:A');
  });

  it('Left after a jump focuses the first title of the letter', async () => {
    await longList();
    await focus('alpha:S');
    await pressKey(KEY.enter);
    await posterShown('Title401');
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(card('Title401'));
  });

  it('marks the letter at the top of the grid, and follows it as the grid scrolls', async () => {
    await longList();
    expect(letter('A')).toHaveAttribute('aria-current', 'true');
    await focus('alpha:S');
    await pressKey(KEY.enter);
    await posterShown('Title401');
    await waitFor(() => expect(letter('S')).toHaveAttribute('aria-current', 'true'));
    expect(letter('A')).not.toHaveAttribute('aria-current');
    // One row up: its last title (position 395) is under B.
    await pressKey(KEY.left);
    await pressKey(KEY.up);
    await waitFor(() => expect(letter('B')).toHaveAttribute('aria-current', 'true'));
    expect(letter('S')).not.toHaveAttribute('aria-current');
  });

  it('jumps far down by position: the pages around the target are read, not the ones before it', async () => {
    const { calls } = await longList();
    calls.browse.length = 0;
    await focus('alpha:S');
    await pressKey(KEY.enter);
    await posterShown('Title401');
    await waitFor(() => expect(seeks(calls).length).toBeGreaterThan(0));
    // Position 400 is on page 10; its neighbours are read by seek, and nothing before page 9.
    expect(seeks(calls).every((seek) => seek >= 9 * 40 && seek <= 12 * 40)).toBe(true);
    expect(seeks(calls)).toContain(400);
    // Every seek read carries the window cursor of the first read, which pins the list.
    const seekReads = calls.browse.filter((query) => query.has('seek'));
    expect(seekReads.every((query) => query.get('cursor') === 'w')).toBe(true);
    expect(calls.browse.length).toBeLessThanOrEqual(4);
  });

  it('jumps to the first run of a letter that the collation split in two', async () => {
    const calls = serveLibrary(server, {
      ...positioned(300),
      letters: indexOf(
        [
          { letter: 'A', position: 0 },
          { letter: 'C', position: 100 },
          { letter: 'D', position: 200 },
          { letter: 'C', position: 250 },
        ],
        300,
      ),
    });
    setup();
    await firstRead(calls);
    await waitFor(() => expect(letter('C')).not.toBeDisabled());
    calls.browse.length = 0;
    await focus('alpha:C');
    await pressKey(KEY.enter);
    await posterShown('Title101');
    expect(seeks(calls)).toContain(80);
    expect(seeks(calls).some((seek) => seek >= 200)).toBe(false);
  });

  it('shows skeleton cards for the titles that are not loaded yet', async () => {
    serveLibrary(server, {
      letters: LONG,
      browse: async (query) => {
        if (query.has('seek')) await new Promise((resolve) => setTimeout(resolve, 150));
        return positioned(600).browse(query);
      },
    });
    setup();
    await screen.findByRole('button', { name: /Title 3/ });
    await waitFor(() => expect(letter('S')).not.toBeDisabled());
    await focus('alpha:S');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryAllByTestId('card-skeleton').length).toBeGreaterThan(0));
    await posterShown('Title401');
    expect(screen.queryAllByTestId('card-skeleton')).toHaveLength(0);
  });

  it('is restored with the next visit: the grid shows the same place, by position', async () => {
    const memory = new LibraryMemory();
    const { calls, unmount } = await longList(memory);
    await focus('alpha:S');
    await pressKey(KEY.enter);
    await posterShown('Title401');
    await pressKey(KEY.left);
    unmount();
    setup(memory);
    await posterShown('Title401');
    // The grid starts at the row of the card it had the focus on, with the whole list's length.
    expect(screen.getByTestId('grid-track').style.transform).toBe(
      `translateY(${-66 * GRID_ROW_PITCH}px)`,
    );
    expect(screen.getByTestId('grid-track').style.height).toBe(`${100 * GRID_ROW_PITCH}px`);
    expect(calls.browse.some((query) => query.has('name_prefix'))).toBe(false);
  });
});

describe('Browse choices', () => {
  it('are kept per library for the session, and the next visit starts with them', async () => {
    const calls = serveLibrary(server, {
      libraries: [
        library({ id: 'lib-1', name: 'Films A', type: 'movies' }),
        library({ id: 'lib-2', name: 'Films B', type: 'movies' }),
      ],
    });
    const memory = new LibraryMemory();
    const first = setup(memory);
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    await screen.findByTestId('sort-list');
    await focus('lib-dialog-sort-runtime');
    await pressKey(KEY.enter);
    await waitFor(() => expect(lastRead(calls).get('sort')).toBe('-runtime'));
    first.unmount();
    // The next visit: the first read already carries the sort.
    calls.browse.length = 0;
    const second = setup(memory);
    await firstRead(calls);
    expect(calls.browse[0]!.get('sort')).toBe('-runtime');
    second.unmount();
    // Another library has choices of its own.
    memory.selectLibrary('movie', 'lib-2');
    calls.browse.length = 0;
    setup(memory);
    await firstRead(calls);
    expect(calls.browse[0]!.get('library_id')).toBe('lib-2');
    expect(calls.browse[0]!.get('sort')).toBe('title');
  });
});
