import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { Focusable, getCurrentFocusKey, setFocus } from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import { account, BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { homeSection, resumeEpisode, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey, FocusIndexMemory, type CatalogItem } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { HERO_INFO_KEY, HERO_PAGER_KEY, HERO_PLAY_KEY, HERO_RETRY_KEY } from './Carousel';
import { HomeScreen } from './HomeScreen';

// Home with a featured section: the carousel, the rows without it, and the two modes of the hero.
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

// A stand-in for the shell's top bar: the focus starts there, as it does in the app, and not in the rows.
function setup(memory = new FocusIndexMemory()) {
  const onPlay = vi.fn<(item: CatalogItem, intent?: unknown) => void>();
  const onOpenDetail = vi.fn<(target: DetailTarget) => void>();
  const view = renderWithSilo(
    <>
      <Focusable focusKey="bar" autoFocus>
        bar
      </Focusable>
      <HomeScreen
        rowMemory={memory}
        onPlay={onPlay}
        onOpenDetail={onOpenDetail}
        onExploreSection={vi.fn()}
      />
    </>,
    { session: signedIn() },
  );
  return { onPlay, onOpenDetail, ...view };
}

const featuredSection = (overrides: Partial<ReturnType<typeof homeSection>> = {}) =>
  homeSection('feat', 12, { featured: true, item_limit: 5, title: 'Trending', ...overrides });
const rowTitles = () => screen.getAllByTestId('row-title').map((el) => el.textContent);
const carousel = () => screen.findByTestId('hero-carousel');
const focus = (focusKey: string) => act(async () => void (await setFocus(focusKey)));
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const shownSlide = () => screen.getByTestId('hero-title').textContent;

describe('Home: the featured section is the carousel', () => {
  it('shows the first featured section as the carousel, not as a row', async () => {
    serveHome(server, { sections: [homeSection('recent', 3), featuredSection()] });
    setup();
    await carousel();
    await screen.findByTestId('row-recent');
    expect(screen.queryByTestId('row-feat')).toBeNull();
    expect(rowTitles()).toEqual(['Row recent']);
    expect(shownSlide()).toBe('feat 1');
  });

  it("reads the featured section whole, at the hero's artwork width", async () => {
    const calls = serveHome(server, { sections: [featuredSection(), homeSection('recent', 3)] });
    setup();
    await carousel();
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0]!.id).toBe('feat');
    expect(calls.rows[0]!.query.has('item_limit')).toBe(false);
    expect(calls.rows[0]!.query.get('backdrop_width')).toBe('1920');
  });

  it('shows as many slides as the layout item limit says', async () => {
    serveHome(server, { sections: [featuredSection({ item_limit: 5 })] });
    setup();
    await carousel();
    expect(screen.getByTestId('hero-slide-count')).toHaveTextContent('05');
  });

  it('shows ten slides when the section names no limit', async () => {
    serveHome(server, { sections: [featuredSection({ item_limit: 0 })] });
    setup();
    await carousel();
    expect(screen.getByTestId('hero-slide-count')).toHaveTextContent('10');
  });

  it('keeps a second featured section as a row', async () => {
    serveHome(server, {
      sections: [featuredSection(), homeSection('second', 3, { featured: true, title: 'Second' })],
    });
    setup();
    await carousel();
    await screen.findByTestId('row-second');
    expect(screen.queryByTestId('row-feat')).toBeNull();
  });

  it('has no carousel without a featured section, and the hero follows the first card as before', async () => {
    const calls = serveHome(server, { sections: [homeSection('recent', 3)] });
    setup();
    await screen.findByTestId('row-recent');
    expect(screen.queryByTestId('hero-carousel')).toBeNull();
    expect(screen.queryByTestId('hero-skeleton')).toBeNull();
    expect(calls.rows).toHaveLength(0);
    expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('recent-1');
  });

  it('has no carousel and no row for an empty featured section', async () => {
    serveHome(server, {
      sections: [featuredSection({ items: [], total_count: 0 }), homeSection('recent', 3)],
    });
    setup();
    await screen.findByTestId('row-recent');
    await waitFor(() => expect(screen.queryByTestId('hero-skeleton')).toBeNull());
    expect(screen.queryByTestId('hero-carousel')).toBeNull();
    expect(screen.queryByTestId('row-feat')).toBeNull();
    expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('recent-1');
  });
});

describe('Home: the featured section while it loads and when it fails', () => {
  it('shows a hero skeleton while the featured section is read, with the rows already there', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sections = [featuredSection(), homeSection('recent', 3)];
    serveHome(server, { sections });
    server.use(
      http.get(`${BASE_URL}/api/v2/home/sections/feat/items`, async () => {
        await gate;
        return HttpResponse.json(sections[0]);
      }),
    );
    setup();
    await screen.findByTestId('row-recent');
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument();
    release();
    await carousel();
    expect(screen.queryByTestId('hero-skeleton')).toBeNull();
  });

  it('shows "Retry section" when it cannot be read, and OK on it reads it again', async () => {
    let fail = true;
    const sections = [featuredSection(), homeSection('recent', 3)];
    const calls = serveHome(server, {
      sections,
      row: () => (fail ? new Response(null, { status: 500 }) : undefined),
    });
    setup();
    const panel = await screen.findByTestId('hero-error');
    expect(panel).toHaveTextContent('This featured section could not be loaded right now.');
    // The rows are all there.
    await screen.findByTestId('row-recent');
    fail = false;
    await focus(HERO_RETRY_KEY);
    await pressKey(KEY.enter);
    await carousel();
    expect(screen.queryByTestId('hero-error')).toBeNull();
    expect(calls.rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Home: the buttons of a slide', () => {
  it('"More Info" opens the page of the slide: a movie and a series alike', async () => {
    const items = [
      catalogItem({ content_id: 'm1', type: 'movie', title: 'Heat' }),
      catalogItem({ content_id: 's1', type: 'series', title: 'Severance', play_content_id: 'e1' }),
    ];
    serveHome(server, { sections: [featuredSection({ items })] });
    const { onOpenDetail, onPlay } = setup();
    await carousel();
    fireEvent.click(screen.getByRole('button', { name: 'More Info' }));
    expect(onOpenDetail).toHaveBeenLastCalledWith({ itemId: 'm1' });
    await focus(HERO_PAGER_KEY);
    await pressKey(KEY.right);
    expect(shownSlide()).toBe('Severance');
    fireEvent.click(screen.getByRole('button', { name: 'More Info' }));
    expect(onOpenDetail).toHaveBeenLastCalledWith({ itemId: 's1' });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('"Play" plays what the slide points at and resumes without asking', async () => {
    const items = [
      catalogItem({ content_id: 's1', type: 'series', title: 'Severance', play_content_id: 'e7' }),
    ];
    serveHome(server, { sections: [featuredSection({ items })] });
    const { onPlay, onOpenDetail } = setup();
    await carousel();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]![0]).toMatchObject({ content_id: 'e7', title: 'Severance' });
    expect(onPlay.mock.calls[0]![1]).toEqual({ kind: 'resume' });
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});

describe('Home: the two modes of the hero', () => {
  const rowCard = (id: string) => cardFocusKey('recent', id);
  const sections = () => [featuredSection(), homeSection('recent', 3), homeSection('later', 3)];

  it('Down from the hero goes to the first row, whose card the hero then shows', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await screen.findByTestId('row-recent');
    await focus(HERO_PLAY_KEY);
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'true');
    await pressKey(KEY.down);
    await focusKeyIs(rowCard('recent-1'));
    await waitFor(() =>
      expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('recent-1'),
    );
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'false');
    // The stage moves up so the rows get their room; the carousel's hero is taller than the card's.
    expect(document.querySelector('.home-stage')).toHaveAttribute('data-rows', 'true');
  });

  it('follows the focus from card to card while it is in the rows', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await focus(HERO_PLAY_KEY);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs(rowCard('recent-2'));
    await waitFor(
      () => expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('recent-2'),
      { timeout: 3000 },
    );
  });

  it('Up from the first row goes back to the button it left, and the carousel shows the same slide', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await focus(HERO_INFO_KEY);
    await pressKey(KEY.down);
    await focusKeyIs(rowCard('recent-1'));
    await pressKey(KEY.up);
    await focusKeyIs(HERO_INFO_KEY);
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'true');
    expect(document.querySelector('.hero-card')).toBeNull();
    expect(document.querySelector('.home-stage')).toHaveAttribute('data-rows', 'false');
  });

  it('returns to the slide it showed, also when it was paged before the focus went down', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await focus(HERO_PAGER_KEY);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(screen.getByTestId('hero-slide-number')).toHaveTextContent('03');
    await pressKey(KEY.down);
    await focusKeyIs(rowCard('recent-1'));
    await pressKey(KEY.up);
    await focusKeyIs(HERO_PAGER_KEY);
    expect(screen.getByTestId('hero-slide-number')).toHaveTextContent('03');
    expect(shownSlide()).toBe('feat 3');
  });

  it('Down within the rows and Up between them leave the hero alone until the first row is left upwards', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await focus(HERO_PLAY_KEY);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs(cardFocusKey('later', 'later-1'));
    await pressKey(KEY.up);
    await focusKeyIs(rowCard('recent-1'));
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'false');
    await pressKey(KEY.up);
    await focusKeyIs(HERO_PLAY_KEY);
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'true');
  });

  const hover = async (element: Element, focusKey: string) => {
    fireEvent.mouseMove(element);
    await focusKeyIs(focusKey);
    await act(async () => {});
  };
  const stage = () => document.querySelector('.home-stage');
  const rowsOffset = () => document.querySelector<HTMLElement>('.home-rows-inner')!.style.transform;

  it('keeps the rows where they are when the pointer hovers the bar; the next key brings the mode in line', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await focus(HERO_PLAY_KEY);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs(cardFocusKey('later', 'later-1'));
    await waitFor(() => expect(rowsOffset()).not.toBe('translateY(0px)'));
    const lifted = rowsOffset();
    await hover(screen.getByText('bar'), 'bar');
    expect(stage()).toHaveAttribute('data-rows', 'true');
    expect(rowsOffset()).toBe(lifted);
    // A key on the bar (here one that goes nowhere) brings the mode to where the focus is.
    await pressKey(KEY.left);
    await waitFor(() => expect(stage()).toHaveAttribute('data-rows', 'false'));
    expect(rowsOffset()).toBe('translateY(0px)');
  });

  it('keeps the carousel when the pointer hovers a card of the first row; the next key in the row switches to the rows', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await carousel();
    await screen.findByTestId('row-recent');
    await hover(
      document.querySelector(`[data-focus-key="${rowCard('recent-1')}"]`)!,
      rowCard('recent-1'),
    );
    expect(stage()).toHaveAttribute('data-rows', 'false');
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'true');
    await pressKey(KEY.right);
    await focusKeyIs(rowCard('recent-2'));
    await waitFor(() => expect(stage()).toHaveAttribute('data-rows', 'true'));
    expect(screen.getByTestId('hero-carousel')).toHaveAttribute('data-shown', 'false');
  });

  it('brings the mode in line also for a key that the card menu swallows (OK held on a card)', async () => {
    serveHome(server, {
      sections: [
        featuredSection(),
        homeSection('cw', 2, { section_type: 'continue_watching', items: [resumeEpisode('e1')] }),
      ],
    });
    setup();
    await carousel();
    const card = cardFocusKey('cw', 'e1');
    await screen.findByTestId('row-cw');
    await hover(document.querySelector(`[data-focus-key="${card}"]`)!, card);
    expect(stage()).toHaveAttribute('data-rows', 'false');
    // Home's capture handler stops this press for good; the mode must have been set before that.
    fireEvent.keyDown(window, { keyCode: KEY.enter });
    await waitFor(() => expect(stage()).toHaveAttribute('data-rows', 'true'));
  });

  const manyRows = () => [
    featuredSection(),
    ...Array.from({ length: 7 }, (_, i) => homeSection(`r${i}`, 3)),
  ];

  it('shows the rows from the first one under the carousel when the memory points to a later row', async () => {
    serveHome(server, { sections: manyRows() });
    const memory = new FocusIndexMemory();
    memory.set('home:last-row', 5);
    setup(memory);
    await carousel();
    await screen.findByTestId('row-r5');
    const inner = document.querySelector<HTMLElement>('.home-rows-inner')!;
    expect(inner.style.transform).toBe('translateY(0px)');
  });

  it('keeps the first rows filled with cards under the carousel when the memory points far down', async () => {
    serveHome(server, { sections: manyRows() });
    const memory = new FocusIndexMemory();
    memory.set('home:last-row', 6);
    setup(memory);
    await carousel();
    await screen.findByTestId('row-r6');
    expect(within(screen.getByTestId('row-r0')).getAllByRole('button').length).toBeGreaterThan(0);
  });
});

describe('Home: Up from the first row when the featured section failed', () => {
  it('lands on "Retry section", which the carousel panel offers, decided by the stack of hero and rows', async () => {
    serveHome(server, {
      sections: [featuredSection(), homeSection('recent', 3)],
      row: () => new Response(null, { status: 500 }),
    });
    setup();
    await screen.findByTestId('hero-error');
    await screen.findByTestId('row-recent');
    await focus(cardFocusKey('recent', 'recent-1'));
    const search = spySpatialSearch();
    await pressKey(KEY.up);
    await focusKeyIs(HERO_RETRY_KEY);
    expect(search.count).toBe(0);
    search.restore();
  });

  it('Down from the bar enters the panel before the rows', async () => {
    serveHome(server, {
      sections: [featuredSection(), homeSection('recent', 3)],
      row: () => new Response(null, { status: 500 }),
    });
    setup();
    await screen.findByTestId('hero-error');
    await screen.findByTestId('row-recent');
    await focusKeyIs('bar');
    await pressKey(KEY.down);
    await focusKeyIs(HERO_RETRY_KEY);
  });
});

describe('Home: "More Info" on an episode that is being watched', () => {
  it.each(['in_progress', 'next_up'])(
    'opens its page and does not play it (%s)',
    async (itemSource) => {
      const items = [
        catalogItem({
          content_id: 'e1',
          type: 'episode',
          title: 'Pilot',
          series_title: 'Show',
          item_source: itemSource,
        }),
      ];
      serveHome(server, { sections: [featuredSection({ items })] });
      const { onOpenDetail, onPlay } = setup();
      await carousel();
      fireEvent.click(screen.getByRole('button', { name: 'More Info' }));
      expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'e1' });
      expect(onPlay).not.toHaveBeenCalled();
    },
  );
});
