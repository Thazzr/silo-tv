import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, setFocus, type NavApi } from '../../app/nav';
import { ShellScreen } from '../../app/shell/ShellScreen';
import { ShellMemory } from '../../app/shell/tabs';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  branding,
  catalogItem,
  library,
  profile,
  profileCollection,
} from '../../test/flowFixtures';
import { homeSection } from '../../test/homeFixtures';
import {
  collectionCard,
  collectionTab,
  serveLibrary,
  titles,
  type LibraryServe,
} from '../../test/libraryFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { cardFocusKey, FocusIndexMemory, gridCardKey } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { SectionGridScreen } from '../home/SectionGridScreen';
import { CollectionScreen } from './CollectionScreen';
import type { LibraryView } from './libraryMemory';
import type { CollectionTarget } from './targets';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Screen =
  | { name: 'shell' }
  | { name: 'grid'; sectionId: string; title: string; library?: { id: string; type?: string } }
  | ({ name: 'collection' } & CollectionTarget)
  | ({ name: 'detail' } & DetailTarget);

/** The shell on the Movies tab with the row grid, a collection page and a detail stand-in. */
function renderMovies(
  options: {
    tab?: 'movies' | 'series';
    /** The sub-view and anything else the tab remembered from an earlier visit. */
    view?: LibraryView;
    prepare?: (memory: ShellMemory) => void;
  } = {},
) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memory = new ShellMemory();
  memory.selectTab(options.tab ?? 'movies');
  if (options.view) memory.library.selectView('movie', options.view);
  options.prepare?.(memory);
  const gridMemory = new FocusIndexMemory();
  const onPlay = vi.fn();
  const renderScreen = (screenState: Screen, nav: NavApi<Screen>) => {
    switch (screenState.name) {
      case 'shell':
        return (
          <ShellScreen
            memory={memory}
            onPlay={onPlay}
            onOpenDetail={(target) => nav.push({ name: 'detail', ...target })}
            onExploreSection={(section) =>
              nav.push({
                name: 'grid',
                sectionId: section.id,
                title: section.title,
                library: section.library,
              })
            }
            onOpenCollection={(target) => nav.push({ name: 'collection', ...target })}
            onSwitchProfile={() => undefined}
            onSwitchServer={() => undefined}
            launchMode="every"
            onLaunchMode={() => undefined}
          />
        );
      case 'grid':
        return (
          <SectionGridScreen
            sectionId={screenState.sectionId}
            title={screenState.title}
            library={screenState.library}
            memory={gridMemory}
            onPlay={onPlay}
            onOpenDetail={(target) => nav.push({ name: 'detail', ...target })}
            onBack={nav.pop}
          />
        );
      case 'collection':
        return (
          <CollectionScreen
            target={screenState}
            memory={gridMemory}
            onPlay={onPlay}
            onOpenDetail={(target) => nav.push({ name: 'detail', ...target })}
            onBack={nav.pop}
          />
        );
      case 'detail':
        return (
          <main data-testid="detail-stand-in">
            <h1>Detail of {screenState.itemId}</h1>
          </main>
        );
    }
  };
  render(
    <QueryClientProvider client={newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'shell' }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { memory };
}

function serve(options: LibraryServe = {}) {
  const calls = serveLibrary(server, options);
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () =>
      HttpResponse.json(profileCollection([profile({ id: 'p1', name: 'Alex' })])),
    ),
    http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.json(branding())),
  );
  return calls;
}

const tab = (name: string) => screen.getByRole('button', { name });
const pill = (name: string) => screen.getByRole('tab', { name });

async function focus(key: string) {
  await act(async () => {
    await setFocus(key);
  });
  await waitFor(() => expect(getCurrentFocusKey()).toBe(key));
}

const TWO_LIBRARIES: LibraryServe = {
  libraries: [
    library({ id: 'lib-a', name: 'Films A', type: 'movies' }),
    library({ id: 'lib-b', name: 'Films B', type: 'movies' }),
  ],
  sections: { 'lib-a': [homeSection('a-rec', 3)], 'lib-b': [homeSection('b-rec', 3)] },
};

describe('Back in a library tab', () => {
  it('leaves a row for the sub-view pills, then the library pills, then the tab bar, then Home', async () => {
    serve(TWO_LIBRARIES);
    renderMovies();
    await screen.findByText('Row a-rec');
    await waitFor(() => expect(tab('Movies')).toHaveFocus());
    // Down: the library pills, the sub-view pills, the first card.
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('lib-pill:lib-a');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-a/a-rec', 'a-rec-1'));
    await pressKey(KEY.back);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.back);
    expect(getCurrentFocusKey()).toBe('lib-pill:lib-a');
    await pressKey(KEY.back);
    expect(tab('Movies')).toHaveFocus();
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
    // The shell's own rule from there: Home.
    await pressKey(KEY.back);
    await waitFor(() => expect(tab('Home')).toHaveFocus());
  });

  it('skips the library pills when there is a single library', async () => {
    serve();
    renderMovies();
    await screen.findByText('Row lib-1-rec');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-1/lib-1-rec', 'lib-1-rec-1'));
    await pressKey(KEY.back);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.back);
    expect(tab('Movies')).toHaveFocus();
  });

  it('reaches the pills with Up from the first row, and the tab bar from the pills', async () => {
    serve();
    renderMovies();
    await screen.findByText('Row lib-1-rec');
    await focus(cardFocusKey('lib-1/lib-1-rec', 'lib-1-rec-1'));
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('lib-view:recommended');
    await pressKey(KEY.up);
    expect(tab('Movies')).toHaveFocus();
  });

  it('goes from the Browse toolbar and the alphabet rail to the sub-view pills', async () => {
    serve();
    renderMovies({ view: 'browse' });
    await screen.findByTestId('browse');
    await focus('browse-sort');
    await pressKey(KEY.back);
    expect(getCurrentFocusKey()).toBe('lib-view:browse');
    await waitFor(() => expect(document.querySelector('[data-letter="A"]')).not.toBeDisabled());
    await focus('alpha:A');
    await pressKey(KEY.back);
    expect(getCurrentFocusKey()).toBe('lib-view:browse');
  });

  it('closes the sort list first, back onto the Sort pill', async () => {
    serve();
    renderMovies({ view: 'browse' });
    await screen.findByTestId('browse');
    await focus('browse-sort');
    await pressKey(KEY.enter);
    await screen.findByTestId('sort-list');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('sort-list')).toBeNull());
    expect(getCurrentFocusKey()).toBe('browse-sort');
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
    // The next Back is the content's: the sub-view pills.
    await pressKey(KEY.back);
    expect(getCurrentFocusKey()).toBe('lib-view:browse');
  });

  it('leaves a facet for the list of filters, then closes the panel and applies the choice', async () => {
    const calls = serve();
    renderMovies({ view: 'browse' });
    await screen.findByTestId('browse');
    await focus('browse-filter');
    await pressKey(KEY.enter);
    const panel = await screen.findByTestId('filter-panel');
    await within(panel).findByRole('button', { name: /Genre/ });
    await focus('lib-dialog-facet-genre');
    await pressKey(KEY.enter);
    await within(panel).findByTestId('facet-values');
    await focus('lib-dialog-value-genre-Drama');
    await pressKey(KEY.enter);
    // Back from the values: the facets, on the facet, with the panel still open.
    await pressKey(KEY.back);
    await within(panel).findByTestId('facet-summary-genre');
    await waitFor(() => expect(getCurrentFocusKey()).toBe('lib-dialog-facet-genre'));
    expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
    expect(calls.browse).toHaveLength(1);
    // Back from the facets: the panel closes and the choice is sent.
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('filter-panel')).toBeNull());
    await waitFor(() => expect(calls.browse).toHaveLength(2));
    expect(JSON.parse(calls.browse[1]!.get('groups')!)).toEqual([
      { match: 'any', rules: [{ field: 'genre', op: 'contains', value: 'Drama' }] },
    ]);
    expect(getCurrentFocusKey()).toBe('browse-filter');
    expect(screen.getByTestId('filter-count')).toHaveTextContent('1');
  });
});

describe('Recommended in the shell', () => {
  it('Explore all opens the row as a grid of the library, and Back returns to the same card', async () => {
    const calls = serve({
      sections: {
        'lib-1': [
          homeSection('more', 0, {
            title: 'More',
            items: titles('Row', 3),
            total_count: 90,
            has_more: true,
          }),
        ],
      },
      browse: () => ({
        items: titles('Page', 40),
        total: 90,
        total_exact: true,
        window_cursor: 'w',
        page: { has_more: true, next_cursor: 'c2' },
      }),
    });
    renderMovies();
    await screen.findByText('More');
    await focus(cardFocusKey('lib-1/more', 'explore'));
    await pressKey(KEY.enter);

    expect(await screen.findByTestId('section-grid-title')).toHaveTextContent('More');
    await waitFor(() => expect(getCurrentFocusKey()).toBe(gridCardKey('lib-1:more', 'Page1')));
    // The grid reads the library's section, not Home's.
    const read = calls.browse[0]!;
    expect(read.get('source')).toBe('section');
    expect(read.get('scope')).toBe('library');
    expect(read.get('library_id')).toBe('lib-1');
    expect(read.get('section_id')).toBe('more');
    expect(read.has('type')).toBe(false);
    await pressKey(KEY.down);

    await pressKey(KEY.back);
    await screen.findByText('More');
    await waitFor(() => expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-1/more', 'explore')));
    expect(screen.queryByTestId('section-grid')).toBeNull();
    expect(pill('Recommended')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Collections in the shell', () => {
  const COLLECTIONS: LibraryServe = {
    collections: {
      'lib-1': collectionTab(
        'lib-1',
        [
          {
            name: 'Franchises',
            order: 0,
            cards: [collectionCard('c1', { title: 'Space Saga' }), collectionCard('c2')],
          },
        ],
        undefined,
        { c1: 'The whole saga, in order.' },
      ),
    },
    collectionItems: () => ({
      items: [
        catalogItem({ content_id: 'm1', title: 'Part One' }),
        catalogItem({ content_id: 'm2', title: 'Part Two' }),
      ],
    }),
  };

  it('opens a collection as a page and Back returns to its poster, on the Collections view', async () => {
    const calls = serve(COLLECTIONS);
    renderMovies({ view: 'collections' });
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(
        document.querySelector(`[data-focus-key="${gridCardKey('collections:lib-1', 'c2')}"]`),
      ).not.toBeNull(),
    );
    await focus(gridCardKey('collections:lib-1', 'c2'));
    await pressKey(KEY.enter);
    // The page: the collection's title, and its titles in a grid.
    expect(await screen.findByTestId('collection-title')).toHaveTextContent('Collection c2');
    await screen.findByRole('button', { name: /Part Two/ });
    expect(calls.collectionItems[0]).toMatchObject({ id: 'lib-1', collectionId: 'c2' });
    await pressKey(KEY.back);
    await screen.findByTestId('collections');
    await waitFor(() => expect(getCurrentFocusKey()).toBe(gridCardKey('collections:lib-1', 'c2')));
    expect(pill('Collections')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('collection-page')).toBeNull();
  });

  it('Back from a collection lands on the same poster, and Down from the pills returns to it', async () => {
    serve({
      collections: {
        'lib-1': collectionTab('lib-1', [
          {
            name: 'Franchises',
            order: 0,
            cards: [collectionCard('c1'), collectionCard('c2'), collectionCard('c3')],
          },
        ]),
      },
      collectionItems: () => ({ items: [catalogItem({ content_id: 'm1', title: 'Part One' })] }),
    });
    renderMovies({ view: 'collections' });
    await screen.findByTestId('collections');
    const poster = (id: string) => gridCardKey('collections:lib-1', id);
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${poster('c3')}"]`)).not.toBeNull(),
    );
    // The third poster: open it and come back.
    await focus(poster('c3'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('collection-title')).toHaveTextContent('Collection c3');
    await pressKey(KEY.back);
    await screen.findByTestId('collections');
    await waitFor(() => expect(getCurrentFocusKey()).toBe(poster('c3')));
    // The grid also remembers it: up to the pills and down again lands on the third poster,
    // not on the first.
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('lib-view:collections');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(poster('c3'));
  });

  it('shows the description on the collection page', async () => {
    serve(COLLECTIONS);
    renderMovies({ view: 'collections' });
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(
        document.querySelector(`[data-focus-key="${gridCardKey('collections:lib-1', 'c1')}"]`),
      ).not.toBeNull(),
    );
    await focus(gridCardKey('collections:lib-1', 'c1'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('collection-description')).toHaveTextContent(
      'The whole saga, in order.',
    );
  });

  it('opens a title of the collection, and Back returns to the same title', async () => {
    serve(COLLECTIONS);
    renderMovies({ view: 'collections' });
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(
        document.querySelector(`[data-focus-key="${gridCardKey('collections:lib-1', 'c1')}"]`),
      ).not.toBeNull(),
    );
    await focus(gridCardKey('collections:lib-1', 'c1'));
    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Part Two/ });
    await focus(gridCardKey('collection:lib-1:c1', 'm2'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-stand-in')).toHaveTextContent('Detail of m2');
    await pressKey(KEY.back);
    await screen.findByRole('button', { name: /Part Two/ });
    await waitFor(() =>
      expect(getCurrentFocusKey()).toBe(gridCardKey('collection:lib-1:c1', 'm2')),
    );
  });
});

describe('Browse in the shell', () => {
  it('Back from a title opened after a jump to a letter returns to the same poster', async () => {
    const calls = serve({
      letters: {
        letters: [
          { letter: 'A', count: 100, position: 0 },
          { letter: 'S', count: 100, position: 100 },
        ],
        runs: [
          { letter: 'A', position: 0 },
          { letter: 'S', position: 100 },
        ],
        total: 200,
      },
      browse: (query) => {
        const start = Number(query.get('seek') ?? 0);
        return {
          items: titles('Title', Math.min(40, 200 - start), 'movie', start),
          total: 200,
          total_exact: true,
          window_cursor: 'c',
          page: { has_more: start + 40 < 200, next_cursor: 'next' },
        };
      },
    });
    renderMovies({
      view: 'browse',
      prepare: (memory) =>
        memory.library.setBrowse('movie', 'lib-1', {
          sort: 'title',
          descending: false,
          filters: { genre: ['Drama'] },
        }),
    });
    await screen.findByTestId('browse');
    await waitFor(() => expect(document.querySelector('[data-letter="S"]')).not.toBeDisabled());
    await focus('alpha:S');
    await pressKey(KEY.enter);
    // Position 100 is "Title 101".
    await waitFor(() =>
      expect(
        document.querySelector(
          `[data-focus-key="${gridCardKey('browse:lib-1:movie', 'Title101')}"]`,
        ),
      ).not.toBeNull(),
    );
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(gridCardKey('browse:lib-1:movie', 'Title101'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(gridCardKey('browse:lib-1:movie', 'Title102'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-stand-in')).toHaveTextContent('Detail of Title102');
    await pressKey(KEY.back);
    await screen.findByTestId('browse');
    await waitFor(() =>
      expect(getCurrentFocusKey()).toBe(gridCardKey('browse:lib-1:movie', 'Title102')),
    );
    // The same list as before, and never a title prefix.
    const last = calls.browse[calls.browse.length - 1]!;
    expect(last.get('sort')).toBe('title');
    expect(calls.browse.some((query) => query.has('name_prefix'))).toBe(false);
    expect(JSON.parse(last.get('groups')!)).toHaveLength(1);
  });
});
