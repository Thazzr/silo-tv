import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { account } from '../../test/apiFixtures';
import { catalogItem, library } from '../../test/flowFixtures';
import {
  facets,
  serveLibrary,
  titles,
  type LibraryCalls,
  type LibraryServe,
} from '../../test/libraryFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { gridCardKey } from '../../ui/media';
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
  const view = renderWithSilo(
    <LibraryScreen
      kind="movie"
      memory={memory}
      onPlay={vi.fn()}
      onOpenDetail={onOpenDetail}
      onExploreSection={vi.fn()}
      onOpenCollection={vi.fn()}
      switchDelayMs={60_000}
    />,
    { session },
  );
  return { memory, onOpenDetail, ...view };
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
        return { items: titles('Title', 3), total: 3, total_exact: true, window_cursor: 'c' };
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
          : { items: titles('Title', 3), total: 3, total_exact: true, window_cursor: 'c' },
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
    // With a letter chosen the same answer means "nothing matches".
    await focus('alpha:A');
    await pressKey(KEY.enter);
    await waitFor(() =>
      expect(screen.getByTestId('browse-empty')).toHaveTextContent(
        'No titles match these filters.',
      ),
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
      letter: null,
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
    ).toEqual(['DecadeAny ›', 'Clear filters', 'Done']);
  });

  it('lists genre and decade, and nothing else, when the server has extended rules', async () => {
    const calls = serveLibrary(server);
    setup();
    const panel = await openFilter(calls);
    await waitFor(() => expect(calls.capabilities).toBeGreaterThan(0));
    await waitFor(() =>
      expect(
        within(panel)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['GenreAny ›', 'DecadeAny ›', 'Clear filters', 'Done']),
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
    ).toEqual(['GenreAny ›', 'Clear filters', 'Done']);
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
      letter: null,
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

  it('asks the letter index about the library and the filters, not the letter', async () => {
    const calls = serveLibrary(server);
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'year',
      descending: true,
      filters: { genre: ['Action'] },
      letter: 'B',
    });
    setup(memory);
    await waitFor(() => expect(calls.letters).toHaveLength(1));
    expect(calls.letters[0]).toEqual({
      library_id: 'lib-1',
      type: 'movie',
      match: 'all',
      groups: [{ match: 'any', rules: [{ field: 'genre', op: 'contains', value: 'Action' }] }],
    });
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

  it('is reached with Right from the last poster of a row, and Left returns to the grid', async () => {
    const calls = serveLibrary(server, letters(['A', 'B']));
    setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 6/ });
    await focus(card('Title6'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()?.startsWith('alpha:')).toBe(true);
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(card('Title6'));
  });

  it('OK on a letter reads the titles under it and moves the focus onto the first of them', async () => {
    const calls = serveLibrary(server, {
      letters: ['A', 'B'],
      browse: async (query) => {
        // The read of a letter takes a moment: the focus must wait for it.
        if (query.get('name_prefix') === 'B') {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return {
            items: [
              catalogItem({ content_id: 'b1', title: 'Bravo' }),
              catalogItem({ content_id: 'b2', title: 'Bridge' }),
            ],
            total: 2,
            total_exact: true,
            window_cursor: 'c',
          };
        }
        return { items: titles('Title', 10), total: 10, total_exact: true, window_cursor: 'c' };
      },
    });
    const { memory } = setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    await waitFor(() => expect(letter('B')).not.toBeDisabled());
    await focus('alpha:B');
    await pressKey(KEY.enter);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(card('b1')));
    expect(lastRead(calls).get('name_prefix')).toBe('B');
    expect(screen.getByRole('button', { name: /Bridge/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Title 3/ })).toBeNull();
    expect(letter('B')).toHaveAttribute('aria-pressed', 'true');
    expect(memory.browseOf('movie', 'lib-1').letter).toBe('B');
    // OK on the chosen letter shows every title again, and the focus is in the grid there.
    await focus('alpha:B');
    await pressKey(KEY.enter);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(card('Title1')));
    expect(lastRead(calls).has('name_prefix')).toBe(false);
    expect(letter('B')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reads "#" as the titles that start with a digit', async () => {
    const calls = serveLibrary(server, letters(['#', 'A']));
    setup();
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    await waitFor(() => expect(letter('#')).not.toBeDisabled());
    await focus('alpha:#');
    await pressKey(KEY.enter);
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    const query = lastRead(calls);
    expect(query.has('name_prefix')).toBe(false);
    const groups = groupsOf(query)!;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rules.map((r) => `${r.op} ${String(r.value)}`)).toEqual(
      Array.from({ length: 10 }, (_, d) => `begins_with ${d}`),
    );
  });

  it('dims "#" when the server does not advertise extended rules, as its rules need them', async () => {
    const calls = serveLibrary(server, { ...letters(['#', 'A']), extendedRules: false });
    setup();
    await firstRead(calls);
    await waitFor(() => expect(calls.capabilities).toBeGreaterThan(0));
    await screen.findByRole('button', { name: /Title 3/ });
    await waitFor(() => expect(letter('#')).toBeDisabled());
    expect(letter('A')).not.toBeDisabled();
  });

  it('keeps the sort and the filters when a letter is chosen, and the letter when they change', async () => {
    const calls = serveLibrary(server, letters(['A', 'B']));
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', {
      sort: 'rating',
      descending: true,
      filters: { decade: ['1990'] },
      letter: null,
    });
    setup(memory);
    await firstRead(calls);
    await screen.findByRole('button', { name: /Title 3/ });
    await waitFor(() => expect(letter('A')).not.toBeDisabled());
    await focus('alpha:A');
    await pressKey(KEY.enter);
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    let query = lastRead(calls);
    expect(query.get('sort')).toBe('-rating');
    expect(query.get('name_prefix')).toBe('A');
    expect(groupsOf(query)).toEqual([
      { match: 'any', rules: [{ field: 'decade', op: 'is', value: 1990 }] },
    ]);
    // A new sort keeps the letter.
    await screen.findByRole('button', { name: /Title 3/ });
    await focus('browse-sort');
    await pressKey(KEY.enter);
    await screen.findByTestId('sort-list');
    await focus('lib-dialog-sort-year');
    await pressKey(KEY.enter);
    await waitFor(() => expect(calls.browse).toHaveLength(3));
    query = lastRead(calls);
    expect(query.get('sort')).toBe('-year');
    expect(query.get('name_prefix')).toBe('A');
  });

  it('leaves every letter usable when the server cannot say which have titles', async () => {
    const calls = serveLibrary(server, letters('fail'));
    setup();
    await firstRead(calls);
    await waitFor(() => expect(calls.letters).toHaveLength(1));
    await screen.findByRole('button', { name: /Title 3/ });
    expect(letter('Q')).not.toBeDisabled();
    expect(document.querySelectorAll('.alpha-letter.dim')).toHaveLength(0);
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
