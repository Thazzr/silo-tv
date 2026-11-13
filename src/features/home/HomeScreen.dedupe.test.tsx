import { screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { homeSection, serveHome, serveRecipes } from '../../test/homeFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey, FocusIndexMemory } from '../../ui/media';
import { HomeScreen } from './HomeScreen';

// The recipes' avoid_duplicates rule on Home: a row of a marked type drops a card a row above
// shows; every other row, and every row while the gallery is not known, shows what was served.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return renderWithSilo(
    <HomeScreen
      rowMemory={new FocusIndexMemory()}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
    />,
    { session },
  );
}

const one = catalogItem({ content_id: 'one', title: 'One' });
const two = catalogItem({ content_id: 'two', title: 'Two' });
const card = (row: string, id: string) =>
  document.querySelector(`[data-focus-key="${cardFocusKey(row, id)}"]`);

const sections = () => [
  homeSection('top', 1, { items: [one] }),
  homeSection('marked', 1, { section_type: 'marked', items: [one, two], total_count: 2 }),
  homeSection('plain', 1, { section_type: 'plain', items: [one] }),
];

describe('HomeScreen: cards a row above already shows', () => {
  it('drops the card from a row of a marked type and keeps it in the other rows', async () => {
    serveHome(server, { sections: sections() });
    serveRecipes(server, ['marked']);
    setup();
    await screen.findByTestId('row-marked');
    await waitFor(() => expect(card('marked', 'one')).toBeNull());
    expect(card('marked', 'two')).not.toBeNull();
    expect(card('top', 'one')).not.toBeNull();
    expect(card('plain', 'one')).not.toBeNull();
  });

  it('does not draw a marked row that loses all its cards', async () => {
    serveHome(server, {
      sections: [
        homeSection('top', 1, { items: [one] }),
        homeSection('marked', 1, { section_type: 'marked', items: [one] }),
      ],
    });
    serveRecipes(server, ['marked']);
    setup();
    await screen.findByTestId('row-top');
    await waitFor(() => expect(screen.queryByTestId('row-marked')).toBeNull());
  });

  it('shows every row as served while the gallery is pending', async () => {
    serveHome(server, { sections: sections() });
    serveRecipes(server, 'pending');
    setup();
    await screen.findByTestId('row-marked');
    expect(card('marked', 'one')).not.toBeNull();
  });

  it('shows every row as served when the gallery cannot be read', async () => {
    serveHome(server, { sections: sections() });
    serveRecipes(server, 'fail');
    setup();
    await screen.findByTestId('row-marked');
    // Let the failed read settle: the rows must stay whole.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(card('marked', 'one')).not.toBeNull();
  });
});
