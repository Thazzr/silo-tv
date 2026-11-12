import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import { account } from '../../test/apiFixtures';
import { catalogItem, library } from '../../test/flowFixtures';
import { homeSection } from '../../test/homeFixtures';
import { serveLibrary, type LibraryServe } from '../../test/libraryFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey } from '../../ui/media';
import { HERO_PLAY_KEY, HERO_RETRY_KEY } from '../home/Carousel';
import { LibraryScreen, type LibraryScreenProps } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';

// A library's Recommended view with a featured section: the carousel, the rows without it.
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

function setup(
  kind: LibraryScreenProps['kind'] = 'movie',
  memory = new LibraryMemory(),
  queryClient?: QueryClient,
) {
  const onPlay = vi.fn();
  const onOpenDetail = vi.fn();
  renderWithSilo(
    <LibraryScreen
      kind={kind}
      memory={memory}
      onPlay={onPlay}
      onOpenDetail={onOpenDetail}
      onExploreSection={vi.fn()}
      onOpenCollection={vi.fn()}
    />,
    { session: signedIn(), queryClient },
  );
  return { onPlay, onOpenDetail };
}

const featuredSection = (overrides: Partial<ReturnType<typeof homeSection>> = {}) =>
  homeSection('feat', 12, { featured: true, item_limit: 5, title: 'Trending', ...overrides });
const serve = (sections: ReturnType<typeof homeSection>[], extra: Partial<LibraryServe> = {}) =>
  serveLibrary(server, { sections: { 'lib-1': sections }, ...extra });
const carousel = () => screen.findByTestId('hero-carousel');
const rowTitles = () => screen.getAllByTestId('row-title').map((el) => el.textContent);
const focus = (focusKey: string) => act(async () => void (await setFocus(focusKey)));

describe('Recommended: the featured section is the carousel', () => {
  it('shows the first featured section as the carousel and keeps it out of the rows', async () => {
    serve([homeSection('first', 3, { title: 'First' }), featuredSection()]);
    setup();
    await carousel();
    await screen.findByText('First');
    expect(rowTitles()).toEqual(['First']);
    expect(screen.queryByTestId('row-lib-1/feat')).toBeNull();
    expect(screen.getByTestId('hero-slide-count')).toHaveTextContent('05');
  });

  it('reads the featured section of the library whole, at the hero artwork width', async () => {
    const calls = serve([featuredSection(), homeSection('first', 3)]);
    setup();
    await carousel();
    expect(calls.featured).toHaveLength(1);
    expect(calls.featured[0]!.id).toBe('lib-1');
    expect(calls.featured[0]!.sectionId).toBe('feat');
    expect(calls.featured[0]!.query.has('item_limit')).toBe(false);
    expect(calls.featured[0]!.query.get('backdrop_width')).toBe('1920');
  });

  it('shows ten slides when the section names no limit', async () => {
    serve([featuredSection({ item_limit: 0 })]);
    setup();
    await carousel();
    expect(screen.getByTestId('hero-slide-count')).toHaveTextContent('10');
  });

  it('shows a view with only the carousel when there are no other rows', async () => {
    serve([featuredSection()]);
    setup();
    await carousel();
    expect(screen.queryByTestId('recommended-empty')).toBeNull();
  });

  it("shows only the tab's kind of a mixed library in the carousel", async () => {
    const items = [
      catalogItem({ content_id: 'a', title: 'Film A', type: 'movie' }),
      catalogItem({ content_id: 'b', title: 'Show B', type: 'series' }),
      catalogItem({ content_id: 'c', title: 'Film C', type: 'movie' }),
    ];
    serveLibrary(server, {
      libraries: [library({ id: 'lib-1', name: 'Both', type: 'mixed' })],
      sections: { 'lib-1': [featuredSection({ items, item_limit: 10 })] },
    });
    setup('movie');
    await carousel();
    expect(screen.getByTestId('hero-slide-count')).toHaveTextContent('02');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Film A');
  });

  it('has no hero at all without a featured section, as before', async () => {
    const calls = serve([homeSection('first', 3, { title: 'First' })]);
    setup();
    await screen.findByText('First');
    expect(screen.queryByTestId('hero')).toBeNull();
    expect(calls.featured).toHaveLength(0);
  });

  it('has no hero and no row for an empty featured section', async () => {
    serve([featuredSection({ items: [], total_count: 0 }), homeSection('first', 3)]);
    setup();
    await screen.findByText('Row first');
    await waitFor(() => expect(screen.queryByTestId('hero-skeleton')).toBeNull());
    expect(screen.queryByTestId('hero')?.querySelector('.hero-carousel') ?? null).toBeNull();
    expect(rowTitles()).toEqual(['Row first']);
  });

  it('marks the stage as featured, so the stylesheet gives the hero its height', async () => {
    serve([featuredSection(), homeSection('first', 3)]);
    setup();
    await carousel();
    expect(document.querySelector('.library-stage')).toHaveAttribute('data-featured', 'true');
  });

  it('tells the stylesheet how many rows of pills the hero bleeds under', async () => {
    serve([featuredSection()]);
    setup();
    await carousel();
    expect(screen.getByTestId('library-screen')).toHaveAttribute('data-pill-rows', '1');
  });

  it('counts two rows of pills with several libraries', async () => {
    serveLibrary(server, {
      libraries: [
        library({ id: 'lib-1', name: 'A', type: 'movies' }),
        library({ id: 'lib-2', name: 'B', type: 'movies' }),
      ],
      sections: { 'lib-1': [featuredSection()] },
    });
    setup();
    await carousel();
    expect(screen.getByTestId('library-screen')).toHaveAttribute('data-pill-rows', '2');
  });
});

describe('Recommended: loading and failure of the featured section', () => {
  it('shows the web message with "Retry section" in the hero place when it fails, and the rows stay', async () => {
    serve([featuredSection(), homeSection('first', 3)], { sectionItems: 'fail' });
    setup();
    const panel = await screen.findByTestId('hero-error');
    expect(panel).toHaveTextContent('The featured section could not be loaded right now.');
    await screen.findByText('Row first');
    await focus(HERO_RETRY_KEY);
    expect(getCurrentFocusKey()).toBe(HERO_RETRY_KEY);
  });
});

describe('Recommended: the two modes of the hero', () => {
  it('shows the focused card while the focus is in the rows, and the carousel again above them', async () => {
    serve([featuredSection(), homeSection('first', 3, { title: 'First' })]);
    setup();
    await carousel();
    await screen.findByText('First');
    await focus(HERO_PLAY_KEY);
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'true');
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(cardFocusKey('lib-1/first', 'first-1')));
    await waitFor(() =>
      expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('first-1'),
    );
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'false');
    expect(document.querySelector('.library-stage')).toHaveAttribute('data-rows', 'true');
    await pressKey(KEY.up);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(HERO_PLAY_KEY));
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'true');
    expect(document.querySelector('.library-stage')).toHaveAttribute('data-rows', 'false');
  });

  it('opens the page of the slide with "More Info" and plays it with "Play"', async () => {
    serve([featuredSection({ items: [catalogItem({ content_id: 'm1', title: 'Heat' })] })]);
    const { onOpenDetail, onPlay } = setup();
    await carousel();
    screen.getByRole('button', { name: 'More Info' }).click();
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'm1' });
    screen.getByRole('button', { name: 'Play' }).click();
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ content_id: 'm1' }), {
      kind: 'resume',
    });
  });
});

describe('Recommended: the featured section fails', () => {
  it('"Retry section" reads the featured section of the library again', async () => {
    let fail = true;
    const calls = serve([featuredSection(), homeSection('first', 3)], {
      sectionItems: () => (fail ? new Response(null, { status: 500 }) : undefined),
    });
    setup();
    await screen.findByTestId('hero-error');
    const before = calls.featured.length;
    fail = false;
    await focus(HERO_RETRY_KEY);
    await pressKey(KEY.enter);
    await carousel();
    expect(calls.featured.length).toBeGreaterThan(before);
    expect(screen.queryByTestId('hero-error')).toBeNull();
  });

  it('Up from the first row lands on "Retry section", decided by the stack of hero and rows', async () => {
    serve([featuredSection(), homeSection('first', 3)], { sectionItems: 'fail' });
    setup();
    await screen.findByTestId('hero-error');
    await screen.findByText('Row first');
    await focus(cardFocusKey('lib-1/first', 'first-1'));
    const search = spySpatialSearch();
    await pressKey(KEY.up);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(HERO_RETRY_KEY));
    expect(search.count).toBe(0);
    search.restore();
  });

  it('Down from the sub-view pills enters the panel before the rows', async () => {
    serve([featuredSection(), homeSection('first', 3)], { sectionItems: 'fail' });
    setup();
    await screen.findByTestId('hero-error');
    await focus('lib-view:recommended');
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(HERO_RETRY_KEY));
  });
});

describe('Recommended: a remembered row far down', () => {
  const manyRows = () => [
    featuredSection(),
    ...Array.from({ length: 7 }, (_, i) => homeSection(`r${i}`, 3, { title: `Row ${i}` })),
  ];
  const remember = (row: number) => {
    const memory = new LibraryMemory();
    memory.indices.set('lastrow:lib-1:movie', row);
    return memory;
  };

  it('shows the rows from the first one under the carousel', async () => {
    serve(manyRows());
    setup('movie', remember(5));
    await carousel();
    await screen.findByTestId('row-lib-1/r5');
    const inner = document.querySelector<HTMLElement>('.library-rows-inner')!;
    expect(inner.style.transform).toBe('translateY(0px)');
  });

  it('keeps the first rows filled with cards under the carousel', async () => {
    serve(manyRows());
    setup('movie', remember(6));
    await carousel();
    await screen.findByTestId('row-lib-1/r6');
    expect(
      within(screen.getByTestId('row-lib-1/r0')).getAllByRole('button').length,
    ).toBeGreaterThan(0);
  });
});

describe('Recommended: which items the carousel keeps', () => {
  it("keeps every kind of a series library's featured section, a season too", async () => {
    const items = [
      catalogItem({ content_id: 'a', title: 'Show A', type: 'series' }),
      catalogItem({ content_id: 'b', title: 'Season B', type: 'season' }),
      catalogItem({ content_id: 'c', title: 'Episode C', type: 'episode' }),
    ];
    serveLibrary(server, {
      libraries: [library({ id: 'lib-1', name: 'Shows', type: 'series' })],
      sections: { 'lib-1': [featuredSection({ items, item_limit: 10 })] },
    });
    setup('series');
    await carousel();
    expect(screen.getByTestId('hero-slide-count')).toHaveTextContent('03');
  });

  it('reads the featured sections of two libraries apart, though they share a section id', async () => {
    const own = (title: string) =>
      featuredSection({
        items: [catalogItem({ content_id: title, title, type: 'movie' })],
        item_limit: 10,
      });
    const calls = serveLibrary(server, {
      libraries: [
        library({ id: 'lib-a', name: 'Films A', type: 'movies' }),
        library({ id: 'lib-b', name: 'Films B', type: 'movies' }),
      ],
      sections: { 'lib-a': [own('Film of A')], 'lib-b': [own('Film of B')] },
    });
    // Reads are kept, so a key that ignored the library would show A's answer for B.
    setup(
      'movie',
      new LibraryMemory(),
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
      }),
    );
    await carousel();
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Film of A');
    await focus('lib-pill:lib-b');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.getByTestId('hero-title')).toHaveTextContent('Film of B'));
    expect(calls.featured.map((read) => read.id)).toEqual(['lib-a', 'lib-b']);
  });
});
