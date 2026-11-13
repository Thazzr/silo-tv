import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import {
  homeCapabilities,
  homeSection,
  primeHomeCapabilities,
  resumeEpisode,
  serveHome,
} from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, renderWithSilo } from '../../test/renderFlow';
import { FocusIndexMemory, cardFocusKey, type CatalogItem } from '../../ui/media';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import type { DetailTarget } from '../detail/detailMemory';
import { HERO_REST_MS } from './Hero';
import { HomeScreen, LONG_PRESS_MS } from './HomeScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

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

function setup(memory = new FocusIndexMemory(), queryClient?: QueryClient) {
  const onPlay = vi.fn<(item: CatalogItem) => void>();
  const onOpenDetail = vi.fn<(target: DetailTarget) => void>();
  const onExploreSection = vi.fn();
  const view = renderWithSilo(
    <HomeScreen
      rowMemory={memory}
      onPlay={onPlay}
      onOpenDetail={onOpenDetail}
      onExploreSection={onExploreSection}
    />,
    { session: signedIn(), queryClient },
  );
  return { onPlay, onOpenDetail, onExploreSection, memory, ...view };
}

const key = (row: string, id: string) => cardFocusKey(row, id);
const rowTitles = () => screen.getAllByTestId('row-title').map((el) => el.textContent);
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const tap = (keyCode: number) => {
  fireEvent.keyDown(window, { keyCode });
  fireEvent.keyUp(window, { keyCode });
};

describe('HomeScreen: rows', () => {
  it('shows the sections in server order and hides the empty ones', async () => {
    serveHome(server, {
      sections: [
        homeSection('a', 2, { title: 'Alpha' }),
        homeSection('empty', 0, { title: 'Nothing' }),
        homeSection('b', 2, { title: 'Bravo' }),
        homeSection('c', 2, { title: 'Charlie' }),
      ],
    });
    setup();
    await screen.findByTestId('row-a');
    expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(screen.queryByTestId('row-empty')).toBeNull();
  });

  it('asks for at most 20 cards per row (item_limit from the capabilities) at fitting image widths', async () => {
    const calls = serveHome(server);
    const queryClient = newQueryClient();
    primeHomeCapabilities(queryClient, homeCapabilities({ section_item_limit_max: 100 }));
    setup(undefined, queryClient);
    await screen.findByTestId('row-recent');
    const query = calls.lists[0]!;
    expect(query.get('item_limit')).toBe('20');
    expect(query.get('poster_width')).toBe('352');
    expect(query.get('backdrop_width')).toBe('1920');
    expect(query.get('logo_width')).toBe('880');
    expect(query.get('still_width')).toBe('720');
  });

  it('cuts item_limit to what the server accepts', async () => {
    const calls = serveHome(server);
    const queryClient = newQueryClient();
    primeHomeCapabilities(queryClient, homeCapabilities({ section_item_limit_max: 12 }));
    setup(undefined, queryClient);
    await screen.findByTestId('row-recent');
    expect(calls.lists[0]!.get('item_limit')).toBe('12');
  });

  it('sends no item_limit when the server does not report a maximum', async () => {
    const calls = serveHome(server);
    const queryClient = newQueryClient();
    primeHomeCapabilities(queryClient, homeCapabilities({ section_item_limit_max: undefined }));
    setup(undefined, queryClient);
    await screen.findByTestId('row-recent');
    expect(calls.lists[0]!.has('item_limit')).toBe(false);
  });

  it('still loads when the capabilities cannot be read, and holds the line at 20 cards', async () => {
    const calls = serveHome(server, {
      capabilities: 'fail',
      sections: [homeSection('long', 25, { total_count: 25 })],
    });
    // The row starts at its 20th card, as if the focus had been there before.
    const memory = new FocusIndexMemory();
    memory.set('long', 19);
    setup(memory);
    await screen.findByTestId('row-long');
    expect(calls.lists[0]!.has('item_limit')).toBe(false);
    await act(async () => {
      await setFocus(key('long', 'long-20'));
    });
    // 20 cards are all it shows (card 21 does not exist), then comes Explore all.
    expect(document.querySelector(`[data-focus-key="${key('long', 'long-21')}"]`)).toBeNull();
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('long', 'explore'));
  });

  it('shows poster cards in normal rows and landscape cards in Continue Watching and Next Up', async () => {
    serveHome(server, {
      sections: [
        homeSection('cw', 2, {
          section_type: 'continue_watching',
          items: [resumeEpisode('e1'), resumeEpisode('e2')],
        }),
        homeSection('nu', 2, { section_type: 'next_up' }),
        homeSection('recent', 2, { section_type: 'recently_added' }),
      ],
    });
    setup();
    await screen.findByTestId('row-cw');
    const shape = (id: string) =>
      screen.getByTestId(`row-${id}`).querySelector('.row-strip')?.getAttribute('data-shape');
    expect(shape('cw')).toBe('landscape');
    expect(shape('nu')).toBe('landscape');
    expect(shape('recent')).toBe('poster');
    expect(
      within(screen.getByTestId('row-cw')).getAllByTestId('card-progress')[0]!.style.width,
    ).toBe('25%');
  });

  it('ends a row that has more with Explore all, which opens the row', async () => {
    serveHome(server, {
      sections: [homeSection('more', 2, { title: 'More to see', total_count: 80 })],
    });
    const { onExploreSection } = setup();
    await focusKeyIs(key('more', 'more-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('more', 'explore'));
    await pressKey(KEY.enter);
    expect(onExploreSection).toHaveBeenCalledWith({ id: 'more', title: 'More to see' });
  });

  it('has no Explore all card on a row that shows everything', async () => {
    serveHome(server, { sections: [homeSection('all', 2, { total_count: 2 })] });
    setup();
    await focusKeyIs(key('all', 'all-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('all', 'all-2'));
  });

  it('moves between rows with Up and Down and keeps each row’s card', async () => {
    serveHome(server, { sections: [homeSection('a', 4), homeSection('b', 4)] });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('b', 'b-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe(key('a', 'a-3'));
  });

  it('marks its rows box as scrolled by transform, so focus never scrolls it natively', async () => {
    serveHome(server, { sections: [homeSection('a', 3)] });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    expect(document.querySelector('.home-rows')).toHaveAttribute('data-transform-scrolled', 'page');
  });

  it('moves between rows by index, without the library searching', async () => {
    serveHome(server, {
      sections: [homeSection('a', 4), homeSection('b', 4), homeSection('c', 4)],
    });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    const search = spySpatialSearch();
    try {
      await pressKey(KEY.right);
      await pressKey(KEY.down);
      await pressKey(KEY.down);
      await pressKey(KEY.up);
      expect(getCurrentFocusKey()).toBe(key('b', 'b-1'));
      expect(search.count).toBe(0);
    } finally {
      search.restore();
    }
  });

  it('scrolls the rows up with a transform so the focused row sits below the hero', async () => {
    serveHome(server, { sections: [homeSection('a', 3), homeSection('b', 3)] });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    const inner = document.querySelector<HTMLElement>('.home-rows-inner')!;
    expect(inner.style.transform).toBe('translateY(0px)');
    await pressKey(KEY.down);
    await waitFor(() => expect(inner.style.transform).toMatch(/^translateY\(-4\d\dpx\)$/));
  });
});

describe('HomeScreen: the pointer', () => {
  it('focuses a hovered card of a row below the screen without scrolling the page; the next key does', async () => {
    serveHome(server, {
      sections: [homeSection('a', 3), homeSection('b', 3), homeSection('c', 3)],
    });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    const inner = document.querySelector<HTMLElement>('.home-rows-inner')!;
    expect(inner.style.transform).toBe('translateY(0px)');
    // The second row is the one peeking in at the bottom edge.
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${key('b', 'b-1')}"]`)).not.toBeNull(),
    );
    fireEvent.mouseEnter(document.querySelector(`[data-focus-key="${key('b', 'b-1')}"]`)!);
    await focusKeyIs(key('b', 'b-1'));
    await act(async () => {});
    expect(inner.style.transform).toBe('translateY(0px)');
    await pressKey(KEY.down);
    await focusKeyIs(key('c', 'c-1'));
    await waitFor(() => expect(inner.style.transform).toMatch(/^translateY\(-[1-9]\d+px\)$/));
  });
});

describe('HomeScreen: states', () => {
  it('shows the hero skeleton and row skeletons while loading', async () => {
    serveHome(server);
    setup();
    expect(await screen.findByTestId('home-loading')).toBeInTheDocument();
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('row-skeleton').length).toBeGreaterThanOrEqual(2);
    await screen.findByTestId('row-recent');
    expect(screen.queryByTestId('home-loading')).toBeNull();
  });

  it('says so when nothing is there to show', async () => {
    serveHome(server, { sections: [homeSection('a', 0)] });
    setup();
    expect(await screen.findByTestId('home-empty')).toHaveTextContent('Nothing to watch yet');
  });

  it('shows an error with Try again when the sections cannot be read, and recovers', async () => {
    serveHome(server, { sections: 'fail' });
    setup();
    const error = await screen.findByTestId('home-error');
    expect(error).toHaveTextContent('Home could not be loaded.');
    serveHome(server, { sections: [homeSection('later', 2)] });
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('row-later')).toBeInTheDocument();
  });
});

describe('HomeScreen: hero', () => {
  it('shows the first card at once and follows the focus after it has rested', async () => {
    serveHome(server, { sections: [homeSection('a', 3)] });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'a-1');
    await pressKey(KEY.right);
    // Not yet: the focus has not rested.
    expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'a-1');
    await sleep(HERO_REST_MS + 100);
    expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'a-2');
  });

  it('keeps the card it showed when the focus lands on Explore all', async () => {
    serveHome(server, { sections: [homeSection('a', 1, { total_count: 9 })] });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('a', 'explore'));
    await sleep(HERO_REST_MS + 100);
    expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'a-1');
  });
});

describe('HomeScreen: opening a card', () => {
  it('opens the detail page of a movie with OK', async () => {
    serveHome(server, { sections: [homeSection('a', 2)] });
    const { onPlay, onOpenDetail } = setup();
    await focusKeyIs(key('a', 'a-1'));
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'a-2' });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('opens the detail page of a series with OK', async () => {
    serveHome(server, {
      sections: [
        homeSection('a', 1, {
          items: [catalogItem({ content_id: 's1', title: 'A Show', type: 'series' })],
        }),
      ],
    });
    const { onPlay, onOpenDetail } = setup();
    await focusKeyIs(key('a', 's1'));
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 's1' });
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('HomeScreen: removing from Continue Watching', () => {
  const cw = (...ids: string[]) =>
    homeSection('cw', ids.length, {
      title: 'Continue Watching',
      section_type: 'continue_watching',
      items: ids.map((id) => resumeEpisode(id)),
    });

  it('asks on the yellow key, calls the endpoint on Remove and takes the card out of the row', async () => {
    const section = cw('e1', 'e2', 'e3');
    const calls = serveHome(server, {
      sections: [section],
      row: () =>
        HttpResponse.json({
          ...section,
          items: section.items.filter((i) => i.content_id !== 'e1'),
        }),
    });
    setup();
    await focusKeyIs(key('cw', 'e1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    const dialog = await screen.findByTestId('remove-dialog');
    // An episode is removed with its whole show: the dialog names the series.
    expect(dialog).toHaveTextContent('Remove Show e1 from Continue Watching?');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByTestId('remove-dialog')).toBeNull());
    expect(calls.dismissals).toEqual([
      { path: 'continue_watching/e1', body: { progress_updated_at: '2026-01-02T03:04:05.000Z' } },
    ]);
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${key('cw', 'e1')}"]`)).toBeNull(),
    );
    expect(document.querySelector(`[data-focus-key="${key('cw', 'e2')}"]`)).not.toBeNull();
    // The row was read again for what the server holds now.
    expect(calls.rows.map((r) => r.id)).toEqual(['cw']);
  });

  it('keeps the card and calls nothing when the question is cancelled', async () => {
    const calls = serveHome(server, { sections: [cw('e1', 'e2')] });
    setup();
    await focusKeyIs(key('cw', 'e1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    const dialog = await screen.findByTestId('remove-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('remove-dialog')).toBeNull());
    expect(calls.dismissals).toEqual([]);
    expect(document.querySelector(`[data-focus-key="${key('cw', 'e1')}"]`)).not.toBeNull();
  });

  it('asks when OK is held down, and opens the card when OK is only tapped', async () => {
    serveHome(server, { sections: [cw('e1', 'e2')] });
    const { onPlay, onOpenDetail } = setup();
    await focusKeyIs(key('cw', 'e1'));
    tap(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith({ itemId: 'e1' });
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.queryByTestId('remove-dialog')).toBeNull();

    fireEvent.keyDown(window, { keyCode: KEY.enter });
    expect(screen.queryByTestId('remove-dialog')).toBeNull();
    await sleep(LONG_PRESS_MS + 100);
    expect(screen.getByTestId('remove-dialog')).toBeInTheDocument();
    // The repeats of the held key and its release do not reach the dialog or the card.
    fireEvent.keyDown(window, { keyCode: KEY.enter, repeat: true });
    fireEvent.keyUp(window, { keyCode: KEY.enter });
    expect(screen.getByTestId('remove-dialog')).toBeInTheDocument();
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it('names the movie in the question for a movie', async () => {
    serveHome(server, {
      sections: [
        homeSection('cw', 1, {
          section_type: 'continue_watching',
          items: [
            catalogItem({
              content_id: 'mv1',
              title: 'Heat',
              position_seconds: 100,
              duration_seconds: 1000,
            }),
          ],
        }),
      ],
    });
    setup();
    await focusKeyIs(key('cw', 'mv1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    expect(await screen.findByTestId('remove-dialog')).toHaveTextContent(
      'Remove Heat from Continue Watching?',
    );
  });

  it('opens the card when OK is released just before the hold time, and asks at the hold time', async () => {
    serveHome(server, { sections: [cw('e1', 'e2')] });
    const { onOpenDetail } = setup();
    await focusKeyIs(key('cw', 'e1'));
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(window, { keyCode: KEY.enter });
      act(() => void vi.advanceTimersByTime(LONG_PRESS_MS - 1));
      fireEvent.keyUp(window, { keyCode: KEY.enter });
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('remove-dialog')).toBeNull();

      fireEvent.keyDown(window, { keyCode: KEY.enter });
      act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.getByTestId('remove-dialog')).toBeInTheDocument();
      fireEvent.keyUp(window, { keyCode: KEY.enter });
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a Next Up card by its series', async () => {
    const calls = serveHome(server, {
      sections: [
        homeSection('nu', 1, {
          section_type: 'next_up',
          items: [resumeEpisode('n1', { item_source: 'next_up', position_seconds: undefined })],
        }),
      ],
    });
    setup();
    await focusKeyIs(key('nu', 'n1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    const dialog = await screen.findByTestId('remove-dialog');
    expect(dialog).toHaveTextContent('Remove Show n1 from Next Up?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.dismissals).toHaveLength(1));
    expect(calls.dismissals[0]).toEqual({ path: 'next_up/n1', body: { series_id: 'series-n1' } });
  });

  it('does nothing on the yellow key in a row that has no removal', async () => {
    const calls = serveHome(server, { sections: [homeSection('a', 2)] });
    setup();
    await focusKeyIs(key('a', 'a-1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    await sleep(50);
    expect(screen.queryByTestId('remove-dialog')).toBeNull();
    expect(calls.dismissals).toEqual([]);
  });

  it('shows the row error with Try again when the row cannot be read afterwards, and recovers', async () => {
    const section = cw('e1', 'e2');
    let fail = true;
    const calls = serveHome(server, {
      sections: [section],
      row: () =>
        fail
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ ...section, items: [section.items[1]!] }),
    });
    setup();
    await focusKeyIs(key('cw', 'e1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    fireEvent.click(
      within(await screen.findByTestId('remove-dialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('row-cw')).toHaveTextContent('This row could not be loaded.'),
    );
    expect(screen.getAllByTestId('row-title').map((el) => el.textContent)).toEqual([
      'Continue Watching',
    ]);
    // The other rows stay as they are, and the error is a focusable "Try again".
    fail = false;
    fireEvent.click(
      within(screen.getByTestId('row-cw')).getByRole('button', { name: 'Try again' }),
    );
    await waitFor(() =>
      expect(document.querySelector(`[data-focus-key="${key('cw', 'e2')}"]`)).not.toBeNull(),
    );
    expect(calls.rows).toHaveLength(2);
  });
});
