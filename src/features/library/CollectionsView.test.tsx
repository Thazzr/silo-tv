import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { BASE_URL, account } from '../../test/apiFixtures';
import { catalogItem, library } from '../../test/flowFixtures';
import {
  collectionCard,
  collectionTab,
  serveLibrary,
  titles,
  type LibraryServe,
} from '../../test/libraryFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { gridCardKey, FocusIndexMemory, type CatalogItem } from '../../ui/media';
import { CollectionScreen } from './CollectionScreen';
import { LibraryScreen } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
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

function setupView(
  kind: 'movie' | 'series' = 'movie',
  libraryId = 'lib-1',
  memory = new LibraryMemory(),
) {
  memory.selectView(kind, 'collections');
  memory.selectLibrary(kind, libraryId);
  const onOpenCollection = vi.fn();
  const view = renderWithSilo(
    <LibraryScreen
      kind={kind}
      memory={memory}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
      onOpenCollection={onOpenCollection}
      switchDelayMs={60_000}
    />,
    { session: signedIn() },
  );
  return { memory, onOpenCollection, unmount: view.unmount };
}

async function focus(key: string) {
  await act(async () => {
    await setFocus(key);
  });
  await waitFor(() => expect(getCurrentFocusKey()).toBe(key));
}

const gridKey = (id: string) => gridCardKey('collections:lib-1', id);

const TAB = collectionTab(
  'lib-1',
  [
    {
      name: 'Studios',
      order: 2,
      cards: [collectionCard('c3', { title: 'Studio Picks', item_count: 1 })],
    },
    { name: 'Franchises', order: 0, cards: [collectionCard('c1', { title: 'Space Saga' })] },
  ],
  {
    order: 1,
    cards: [
      collectionCard('c2', { title: 'Oscar Winners', item_count: 12 }),
      collectionCard('c0', { title: 'Empty One', item_count: 0 }),
    ],
  },
  { c1: 'The whole saga, in order.' },
);

describe('Collections view', () => {
  it('shows every collection as a poster in the server order, with its title and count', async () => {
    const calls = serveLibrary(server, { collections: { 'lib-1': TAB } });
    setupView();
    await screen.findByTestId('collections');
    const titlesShown = await waitFor(() => {
      const names = screen.getAllByTestId('card-title').map((el) => el.textContent);
      expect(names.length).toBeGreaterThan(0);
      return names;
    });
    // Franchises (0), the ungrouped part (1), Studios (2); the empty collection is left out.
    expect(titlesShown).toEqual(['Space Saga', 'Oscar Winners', 'Studio Picks']);
    expect(screen.getAllByTestId('card-sub').map((el) => el.textContent)).toEqual([
      '4 titles',
      '12 titles',
      '1 title',
    ]);
    expect(calls.collections).toEqual(['lib-1']);
    // Missing artwork keeps the poster placeholder: the cards are there without a picture.
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('card'))).toHaveLength(
      3,
    );
  });

  it('opens a collection on OK', async () => {
    serveLibrary(server, { collections: { 'lib-1': TAB } });
    const { onOpenCollection } = setupView();
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${gridKey('c2')}"]`)).not.toBeNull(),
    );
    await focus(gridKey('c2'));
    await pressKey(KEY.enter);
    expect(onOpenCollection).toHaveBeenCalledWith({
      libraryId: 'lib-1',
      collectionId: 'c2',
      title: 'Oscar Winners',
      type: undefined,
    });
  });

  it('remembers the focused poster: the view shown again enters its grid on it, not on the first', async () => {
    serveLibrary(server, {
      collections: {
        'lib-1': collectionTab('lib-1', [
          {
            name: 'Franchises',
            order: 0,
            cards: [collectionCard('c1'), collectionCard('c2'), collectionCard('c3')],
          },
        ]),
      },
    });
    const memory = new LibraryMemory();
    const first = setupView('movie', 'lib-1', memory);
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${gridKey('c3')}"]`)).not.toBeNull(),
    );
    await focus(gridKey('c3'));
    first.unmount();
    // A new visit with the same memory (the navigation itself starts empty): Down from the
    // sub-view pills enters the grid on the third poster.
    setupView('movie', 'lib-1', memory);
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${gridKey('c3')}"]`)).not.toBeNull(),
    );
    await focus('lib-view:collections');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(gridKey('c3'));
  });

  it('hands a mixed library’s collection over with the tab’s kind', async () => {
    serveLibrary(server, {
      libraries: [library({ id: 'lib-1', name: 'Both', type: 'mixed' })],
      collections: { 'lib-1': TAB },
    });
    const { onOpenCollection } = setupView('series');
    await screen.findByTestId('collections');
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${gridKey('c1')}"]`)).not.toBeNull(),
    );
    await focus(gridKey('c1'));
    await pressKey(KEY.enter);
    expect(onOpenCollection).toHaveBeenCalledWith(expect.objectContaining({ type: 'series' }));
  });

  it('says so when the library has no collections', async () => {
    serveLibrary(server, { collections: { 'lib-1': collectionTab('lib-1', []) } });
    setupView();
    expect(await screen.findByTestId('collections-empty')).toHaveTextContent(
      'This library has no collections.',
    );
  });

  it('shows a grid skeleton while the collections load', async () => {
    serveLibrary(server);
    server.use(
      http.get(`${BASE_URL}/api/v2/library/:id/collections`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json(TAB);
      }),
    );
    setupView();
    expect(await screen.findByTestId('grid-skeleton')).toBeInTheDocument();
    await screen.findByTestId('collections');
    expect(screen.queryByTestId('grid-skeleton')).toBeNull();
  });

  it('shows an error with Try again when the collections cannot be read', async () => {
    let fail = true;
    const calls = serveLibrary(server, { collections: () => (fail ? 'fail' : TAB) });
    setupView();
    expect(await screen.findByTestId('collections-error')).toHaveTextContent(
      'The collections could not be loaded.',
    );
    fail = false;
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    await screen.findByTestId('collections');
    expect(calls.collections.length).toBeGreaterThanOrEqual(2);
  });
});

describe('CollectionScreen', () => {
  function setupPage(
    options: { type?: 'movie' | 'series'; serve?: LibraryServe; memory?: FocusIndexMemory } = {},
  ) {
    const calls = serveLibrary(server, {
      collections: { 'lib-1': TAB },
      ...options.serve,
    });
    const onOpenDetail = vi.fn();
    const onBack = vi.fn();
    const onPlay = vi.fn<(item: CatalogItem) => void>();
    renderWithSilo(
      <CollectionScreen
        target={{ libraryId: 'lib-1', collectionId: 'c1', title: 'Space Saga', type: options.type }}
        memory={options.memory ?? new FocusIndexMemory()}
        onPlay={onPlay}
        onOpenDetail={onOpenDetail}
        onBack={onBack}
      />,
      { session: signedIn() },
    );
    return { calls, onOpenDetail, onBack, onPlay };
  }

  it('shows the title and description, and the titles of the collection in a grid', async () => {
    const { calls } = setupPage({
      serve: {
        collectionItems: () => ({
          items: [
            catalogItem({ content_id: 'm1', title: 'Part One' }),
            catalogItem({ content_id: 'm2', title: 'Part Two' }),
          ],
        }),
      },
    });
    expect(screen.getByTestId('collection-title')).toHaveTextContent('Space Saga');
    await screen.findByRole('button', { name: /Part Two/ });
    await waitFor(() =>
      expect(screen.getByTestId('collection-description')).toHaveTextContent(
        'The whole saga, in order.',
      ),
    );
    const read = calls.collectionItems[0]!;
    expect(read.id).toBe('lib-1');
    expect(read.collectionId).toBe('c1');
    expect(read.query.get('limit')).toBe('40');
    expect(read.query.has('cursor')).toBe(false);
    // The first title has the focus.
    await waitFor(() =>
      expect(getCurrentFocusKey()).toBe(gridCardKey('collection:lib-1:c1', 'm1')),
    );
  });

  it('opens a title on OK through the item opener', async () => {
    const { onOpenDetail } = setupPage({
      serve: {
        collectionItems: () => ({ items: [catalogItem({ content_id: 'm1', title: 'Part One' })] }),
      },
    });
    await screen.findByRole('button', { name: /Part One/ });
    await waitFor(() =>
      expect(getCurrentFocusKey()).toBe(gridCardKey('collection:lib-1:c1', 'm1')),
    );
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'm1' });
  });

  it('shows only the tab’s kind of a mixed library’s collection', async () => {
    setupPage({
      type: 'series',
      serve: {
        collectionItems: () => ({
          items: [
            catalogItem({ content_id: 'm1', title: 'A Movie', type: 'movie' }),
            catalogItem({ content_id: 's1', title: 'A Show', type: 'series' }),
          ],
        }),
      },
    });
    await screen.findByRole('button', { name: /A Show/ });
    expect(screen.queryByRole('button', { name: /A Movie/ })).toBeNull();
  });

  it('follows the cursor of a long collection', async () => {
    const cursors: (string | null)[] = [];
    setupPage({
      serve: {
        collectionItems: (_library, _collection, query) => {
          cursors.push(query.get('cursor'));
          return query.get('cursor') === null
            ? { items: titles('P', 40), page: { has_more: true, next_cursor: 'c2' } }
            : { items: titles('P', 5, 'movie', 40), page: { has_more: false } };
        },
      },
    });
    await waitFor(() =>
      expect(getCurrentFocusKey()).toBe(gridCardKey('collection:lib-1:c1', 'P1')),
    );
    await focus(gridCardKey('collection:lib-1:c1', 'P23'));
    await waitFor(() => expect(cursors).toEqual([null, 'c2']));
  });

  it('says so when the collection is empty, with Back', async () => {
    const { onBack } = setupPage({ serve: { collectionItems: () => ({ items: [] }) } });
    const empty = await screen.findByTestId('collection-empty');
    expect(empty).toHaveTextContent('This collection is empty.');
    await pressKey(KEY.enter);
    expect(onBack).toHaveBeenCalled();
  });

  it('says the collection is gone on a 404, and offers Back', async () => {
    const { onBack } = setupPage({
      serve: { collectionItems: () => new HttpResponse(null, { status: 404 }) },
    });
    const error = await screen.findByTestId('collection-error');
    expect(error).toHaveTextContent('This collection is no longer available.');
    await within(error).findByRole('button', { name: 'Back' });
    await pressKey(KEY.enter);
    expect(onBack).toHaveBeenCalled();
  });

  it('shows an error with Try again for any other failure', async () => {
    let fail = true;
    setupPage({
      serve: {
        collectionItems: () =>
          fail
            ? new HttpResponse(null, { status: 500 })
            : { items: [catalogItem({ content_id: 'm1', title: 'Part One' })] },
      },
    });
    expect(await screen.findByTestId('collection-error')).toHaveTextContent(
      'The titles could not be loaded.',
    );
    fail = false;
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    await screen.findByRole('button', { name: /Part One/ });
  });
});
