import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import { boxSetDetail, serveBoxSet, type BoxSetServe } from '../../test/boxSetFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import type { StartIntent } from '../../playback/resume';
import { gridCardKey } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { BoxSetMemory, type BoxSetTarget } from './boxSetMemory';
import { BoxSetScreen } from './BoxSetScreen';
import { CardPrefsProvider } from '../../ui/media';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const cardKey = (id: string, boxSet = 'bs-1') => gridCardKey(`boxset:${boxSet}`, id);

type Screen =
  | { name: 'boxSet'; target: BoxSetTarget }
  | ({ name: 'detail' } & DetailTarget)
  | { name: 'player'; contentId: string };

const TARGET: BoxSetTarget = { boxSetId: 'bs-1', libraryId: 'lib-1' };

/**
 * The box set page on a screen stack with stub detail and player pages: OK on a film pushes the
 * stub of its detail page, Play pushes the player stub, and Back pops, like the flow does.
 */
function setup(
  target: BoxSetTarget = TARGET,
  options: { queryClient?: QueryClient; onBack?: () => void } = {},
) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memories = new BoxSetMemory();
  const onBack = options.onBack ?? vi.fn();
  const onPlay = vi.fn<(contentId: string, intent?: StartIntent) => void>();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) => {
    if (current.name === 'detail') return <div data-testid="detail-stub">{current.itemId}</div>;
    if (current.name === 'player') return <div data-testid="player-stub">{current.contentId}</div>;
    return (
      <BoxSetScreen
        target={current.target}
        memory={memories.of(current)}
        onPlay={(item, intent) => {
          onPlay(item.content_id, intent);
          nav.push({ name: 'player', contentId: item.content_id });
        }}
        onOpenDetail={(next) => nav.push({ name: 'detail', ...next })}
        onBack={() => {
          onBack();
          nav.pop();
        }}
      />
    );
  };
  const view = render(
    <QueryClientProvider client={options.queryClient ?? newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <CardPrefsProvider>
            <Navigator<Screen> initial={{ name: 'boxSet', target }} renderScreen={renderScreen} />
          </CardPrefsProvider>
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onBack, onPlay, ...view };
}

/**
 * A client that keeps what it has read and never calls it stale: only the page's own "read again
 * when shown" brings it back to the server (the other tests use a client that forgets at once).
 */
const keepingClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });

const serve = (options: BoxSetServe = {}) => serveBoxSet(server, options);
const ready = () => screen.findByTestId('boxset-hero');

describe('BoxSetScreen: the hero', () => {
  it('shows the title, the chip line, the overview and one Play pill, focused', async () => {
    serve({ boxSet: boxSetDetail({}, 8, 0) });
    setup();
    await ready();
    expect(screen.getByTestId('boxset-title')).toHaveTextContent('Great Saga Box Set');
    expect(screen.getByTestId('boxset-meta')).toHaveTextContent('BOX SET · 8 films · 2001–2003');
    expect(screen.getByTestId('detail-synopsis')).toHaveTextContent(
      'Three films about a great saga.',
    );
    // No logo, and exactly one pill in the hero.
    expect(screen.queryByTestId('detail-logo')).toBeNull();
    expect(within(screen.getByTestId('boxset-hero')).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Play Film 1' })).toBeInTheDocument();
    await focusKeyIs('boxset-play');
  });

  it('adds the progress to the chip line once a film is played', async () => {
    serve({ boxSet: boxSetDetail({}, 8, 5) });
    setup();
    await ready();
    expect(screen.getByTestId('boxset-meta')).toHaveTextContent(
      'BOX SET · 8 films · 2001–2003 · 5 of 8 watched',
    );
  });

  it('shows the backdrop of the box set behind the page', async () => {
    serve({ boxSet: boxSetDetail({ backdrop_url: '/img/saga-backdrop.webp' }) });
    setup();
    await ready();
    expect(screen.getByTestId('detail-backdrop')).toHaveAttribute(
      'src',
      `${BASE_URL}/img/saga-backdrop.webp`,
    );
  });

  it('says "Continue · film" with the first unplayed film for a box set in progress', async () => {
    serve({ boxSet: boxSetDetail({}, 4, 2) });
    setup();
    await ready();
    expect(screen.getByRole('button', { name: 'Continue · Film 3' })).toBeInTheDocument();
  });

  it('says "Play" with the first film once all films are played', async () => {
    serve({ boxSet: boxSetDetail({}, 3, 3) });
    setup();
    await ready();
    expect(screen.getByRole('button', { name: 'Play Film 1' })).toBeInTheDocument();
  });

  it('keeps the page where it is for a hovered element in either zone; the next key moves it', async () => {
    // jsdom has no layout: the films block gets a top, so the page has somewhere to go.
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-boxset-films') ? 500 : 0;
    });
    try {
      serve({ boxSet: boxSetDetail({}, 3, 0) });
      setup();
      await ready();
      await focusKeyIs('boxset-play');
      const page = () => screen.getByTestId('boxset').querySelector<HTMLElement>('.detail-page')!;
      const text = () => screen.getByTestId('boxset-hero').querySelector('.detail-text')!;
      expect(page().style.transform).toBe('translateY(0px)');
      // Hero zone: a hovered film is focused, the page stays (inFilms).
      fireEvent.mouseEnter(screen.getByRole('button', { name: /Film 2/ }));
      await focusKeyIs(cardKey('film-2'));
      await act(async () => {});
      expect(page().style.transform).toBe('translateY(0px)');
      expect(text()).toHaveAttribute('data-faded', 'false');
      // A key press inside the grid scrolls the page to the films.
      await pressKey(KEY.right);
      await focusKeyIs(cardKey('film-3'));
      expect(page().style.transform).toBe('translateY(-446px)');
      // Films zone: a hovered Play is focused, the page stays (inTop).
      fireEvent.mouseEnter(screen.getByRole('button', { name: /Play Film 1/ }));
      await focusKeyIs('boxset-play');
      await act(async () => {});
      expect(page().style.transform).toBe('translateY(-446px)');
      expect(text()).toHaveAttribute('data-faded', 'true');
    } finally {
      top.mockRestore();
    }
  });

  it('cuts a long overview and opens the full text from More; Back closes it onto More', async () => {
    const overview = 'The saga goes on and on. '.repeat(30).trim();
    serve({ boxSet: boxSetDetail({ overview }) });
    const { onBack } = setup();
    await ready();
    await focusKeyIs('boxset-play');
    await pressKey(KEY.up);
    await focusKeyIs('detail-more');
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('synopsis-dialog');
    expect(within(dialog).getByTestId('synopsis-full')).toHaveTextContent(overview);
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('synopsis-dialog')).toBeNull());
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('boxset-hero')).toBeInTheDocument();
  });

  it('asks for the box set of its library at the widths of the page', async () => {
    const calls = serve();
    setup({ boxSetId: 'bs-7', libraryId: 'lib-9' });
    await ready();
    expect(calls.reads).toHaveLength(1);
    expect(calls.reads[0]!.id).toBe('bs-7');
    const query = calls.reads[0]!.query;
    expect(query.get('library_id')).toBe('lib-9');
    expect(query.get('poster_width')).toBe('520');
    expect(query.get('backdrop_width')).toBe('1920');
  });
});

describe('BoxSetScreen: loading', () => {
  it('paints the title and the backdrop of the route at once, on a skeleton shaped like the page', async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve({ hold });
    setup({
      ...TARGET,
      boxSetTitle: 'Route Title Box Set',
      backdropUrl: '/img/route-backdrop.webp',
    });
    expect(screen.getByTestId('boxset-title')).toHaveTextContent('Route Title Box Set');
    expect(screen.getByTestId('detail-backdrop')).toHaveAttribute(
      'src',
      `${BASE_URL}/img/route-backdrop.webp`,
    );
    expect(screen.getByTestId('grid-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('boxset-meta')).toBeNull();
    release();
    await ready();
    // The read replaces what the route painted.
    expect(screen.getByTestId('boxset-title')).toHaveTextContent('Great Saga Box Set');
    expect(screen.queryByTestId('grid-skeleton')).toBeNull();
  });
});

describe('BoxSetScreen: Play', () => {
  it('starts the player on the target film with a resume intent', async () => {
    serve({ boxSet: boxSetDetail({}, 4, 2) });
    const { onPlay } = setup();
    await ready();
    await focusKeyIs('boxset-play');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('film-3');
    expect(onPlay).toHaveBeenCalledWith('film-3', { kind: 'resume' });
  });

  it('plays the first film of a box set that was not begun', async () => {
    serve({ boxSet: boxSetDetail({}, 3, 0) });
    const { onPlay } = setup();
    await ready();
    await focusKeyIs('boxset-play');
    await pressKey(KEY.enter);
    expect(onPlay).toHaveBeenCalledWith('film-1', { kind: 'resume' });
  });
});

describe('BoxSetScreen: the films', () => {
  it('lists the films in collection order, as a grid of posters', async () => {
    serve({ boxSet: boxSetDetail({}, 7, 0) });
    setup();
    await ready();
    await screen.findByRole('button', { name: /^Film 1/ });
    expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument();
    const titles = screen.getAllByTestId('card-title').map((el) => el.textContent);
    expect(titles.slice(0, 7)).toEqual([
      'Film 1',
      'Film 2',
      'Film 3',
      'Film 4',
      'Film 5',
      'Film 6',
      'Film 7',
    ]);
    expect(screen.getByRole('button', { name: /^Film 1/ })).toHaveClass('card-grid');
  });

  it('moves from Play into the grid with Down and back with Up; the hero fades while in the grid', async () => {
    serve({ boxSet: boxSetDetail({}, 3, 0) });
    setup();
    await ready();
    await focusKeyIs('boxset-play');
    const text = () => screen.getByTestId('boxset-hero').querySelector('.detail-text')!;
    expect(text()).toHaveAttribute('data-faded', 'false');
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('film-1'));
    expect(text()).toHaveAttribute('data-faded', 'true');
    expect(screen.getByTestId('detail-dim')).toHaveAttribute('data-scrolled', 'true');
    expect(screen.getByTestId('boxset')).toHaveAttribute('data-transform-scrolled', 'page');
    await pressKey(KEY.right);
    await focusKeyIs(cardKey('film-2'));
    await pressKey(KEY.left);
    await pressKey(KEY.up);
    await focusKeyIs('boxset-play');
    expect(text()).toHaveAttribute('data-faded', 'false');
    expect(screen.getByTestId('detail-dim')).toHaveAttribute('data-scrolled', 'false');
  });

  it('opens the detail page of a film on OK, and Back returns onto the same card', async () => {
    serve({ boxSet: boxSetDetail({}, 4, 0) });
    setup();
    await ready();
    await focusKeyIs('boxset-play');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs(cardKey('film-3'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-stub')).toHaveTextContent('film-3');

    await pressKey(KEY.back);
    await ready();
    await focusKeyIs(cardKey('film-3'));
  });

  it('reads the box set again whenever the page shows again', async () => {
    let state = 0;
    const calls = serve({
      boxSet: () => boxSetDetail({}, 3, state),
    });
    setup(TARGET, { queryClient: keepingClient() });
    await ready();
    expect(screen.getByRole('button', { name: 'Play Film 1' })).toBeInTheDocument();
    await focusKeyIs('boxset-play');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await screen.findByTestId('detail-stub');
    // The film was watched meanwhile.
    state = 1;
    await pressKey(KEY.back);
    await screen.findByRole('button', { name: 'Continue · Film 2' });
    expect(calls.reads).toHaveLength(2);
  });
});

describe('BoxSetScreen: failures', () => {
  it('says the box set is not available on a 404, with Back, and reads it only once', async () => {
    const calls = serve({ boxSet: 'gone' });
    const { onBack } = setup();
    const message = await screen.findByTestId('boxset-gone');
    expect(within(message).getByText("This box set isn't available")).toBeInTheDocument();
    expect(
      within(message).getByText(
        'Box sets may be turned off for this library, or too few of its movies are here.',
      ),
    ).toBeInTheDocument();
    await focusKeyIs('boxset-retry');
    fireEvent.click(within(message).getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(calls.reads).toHaveLength(1);
  });

  it('offers Try again on another error, and recovers', async () => {
    let fail = true;
    serve({ boxSet: () => (fail ? 'fail' : boxSetDetail()) });
    setup(TARGET);
    const message = await screen.findByTestId('boxset-error');
    expect(screen.queryByTestId('boxset-gone')).toBeNull();
    await focusKeyIs('boxset-retry');
    fail = false;
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await ready();
    expect(screen.getByTestId('boxset-title')).toHaveTextContent('Great Saga Box Set');
  });

  it('keeps the page when a later read fails', async () => {
    let calls = 0;
    serve({ boxSet: () => (calls++ === 0 ? boxSetDetail() : 'fail') });
    setup(TARGET, { queryClient: keepingClient() });
    await ready();
    await focusKeyIs('boxset-play');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await screen.findByTestId('detail-stub');
    await act(async () => undefined);
    await pressKey(KEY.back);
    await ready();
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId('boxset-error')).toBeNull();
    expect(screen.getByTestId('boxset-title')).toHaveTextContent('Great Saga Box Set');
  });
});
