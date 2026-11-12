import { act, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { Profiler } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { account } from '../../test/apiFixtures';
import { homeSection, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey, FocusIndexMemory } from '../../ui/media';
import type { RowProps } from '../../ui/media';
import { HomeScreen } from './HomeScreen';

// A focus move on Home must redraw the rows involved and no others: HomeScreen re-renders on every
// card (the hero follows the focus), so without stable row props and memoised rows every row and
// card is drawn again per key press, which is what made held arrow keys stutter on the TV.

const { commits, metaItems } = vi.hoisted(() => ({
  commits: new Map<string, number>(),
  metaItems: [] as string[],
}));

// The carousel builds its meta line on every render of its own: which items it was built for says
// whether the carousel was drawn again.
vi.mock('./heroMeta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./heroMeta')>();
  return {
    ...actual,
    heroMeta: (...args: Parameters<typeof actual.heroMeta>) => {
      metaItems.push(args[0].content_id);
      return actual.heroMeta(...args);
    },
  };
});

vi.mock('../../ui/media/Row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/media/Row')>();
  // The Profiler sits inside the wrapper, which only renders when the row's parent re-renders it;
  // a row that is skipped reports nothing, a row that re-renders for its own focus state does.
  const Counted = (props: RowProps<unknown>) => (
    <Profiler id={props.rowId} onRender={(id) => commits.set(id, (commits.get(id) ?? 0) + 1)}>
      <actual.Row {...props} />
    </Profiler>
  );
  return { ...actual, Row: Counted };
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  commits.clear();
  metaItems.length = 0;
});

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

describe('HomeScreen: focus moves', () => {
  it('redraws the row that holds the focus, never the others; a row change redraws two rows', async () => {
    serveHome(server, {
      sections: [homeSection('a', 5), homeSection('b', 5), homeSection('c', 5)],
    });
    const view = renderWithSilo(
      <HomeScreen
        rowMemory={new FocusIndexMemory()}
        onPlay={() => {}}
        onOpenDetail={() => {}}
        onExploreSection={() => {}}
      />,
      { session: signedIn() },
    );
    await screen.findByTestId('row-c');
    // The profile's settings arrive after the rows and redraw them once (spoiler protection reads
    // them); the focus moves below are measured after that.
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    await act(async () => {
      await setFocus(cardFocusKey('a', 'a-1'));
    });
    commits.clear();

    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('a', 'a-2'));
    expect(commits.get('a') ?? 0).toBeGreaterThan(0);
    expect(commits.get('b') ?? 0).toBe(0);
    expect(commits.get('c') ?? 0).toBe(0);

    commits.clear();
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('b', 'b-1'));
    // Row a lost the focus and row b got it; row c is as it was.
    expect(commits.get('c') ?? 0).toBe(0);
    expect(commits.get('b') ?? 0).toBeGreaterThan(0);
  });

  it('does not draw the hidden carousel again when the focus moves from card to card', async () => {
    serveHome(server, {
      sections: [
        homeSection('feat', 4, { featured: true, item_limit: 4 }),
        homeSection('a', 5),
        homeSection('b', 5),
      ],
    });
    const view = renderWithSilo(
      <HomeScreen
        rowMemory={new FocusIndexMemory()}
        onPlay={() => {}}
        onOpenDetail={() => {}}
        onExploreSection={() => {}}
      />,
      { session: signedIn() },
    );
    await screen.findByTestId('hero-carousel');
    await screen.findByTestId('row-b');
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    await act(async () => {
      await setFocus(cardFocusKey('a', 'a-1'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'a-1'),
    );
    metaItems.length = 0;

    await pressKey(KEY.right);
    await waitFor(() =>
      expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'a-2'),
    );
    // The hero drew the card that has the focus; the carousel under it was not asked for a slide.
    expect(metaItems).toContain('a-2');
    expect(metaItems.filter((id) => id.startsWith('feat-'))).toEqual([]);
  });

  it('reads the settings once for all cards, not once per card', async () => {
    serveHome(server, {
      sections: [homeSection('a', 6), homeSection('b', 6), homeSection('c', 6)],
    });
    const view = renderWithSilo(
      <HomeScreen
        rowMemory={new FocusIndexMemory()}
        onPlay={() => {}}
        onOpenDetail={() => {}}
        onExploreSection={() => {}}
      />,
      { session: signedIn() },
    );
    await screen.findByTestId('row-c');
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    expect(document.querySelectorAll('.card').length).toBeGreaterThanOrEqual(18);
    // The provider and the hero's title art read them; a card that did too would add one each.
    const observers = view.queryClient
      .getQueryCache()
      .findAll({ queryKey: ['settings'] })
      .map((query) => query.getObserversCount());
    expect(Math.max(...observers)).toBeLessThanOrEqual(3);
  });
});
