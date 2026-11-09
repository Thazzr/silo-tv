import { act, screen } from '@testing-library/react';
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

const { commits } = vi.hoisted(() => ({ commits: new Map<string, number>() }));

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
beforeEach(() => commits.clear());

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
    renderWithSilo(
      <HomeScreen
        rowMemory={new FocusIndexMemory()}
        onPlay={() => {}}
        onOpenDetail={() => {}}
        onExploreSection={() => {}}
      />,
      { session: signedIn() },
    );
    await screen.findByTestId('row-c');
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
});
