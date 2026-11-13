import { screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { homeSection, serveRecipes } from '../../test/homeFixtures';
import { serveLibrary } from '../../test/libraryFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey } from '../../ui/media';
import { LibraryScreen } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';

// The recipes' avoid_duplicates rule in a library's Recommended view, as on Home.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function render() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  renderWithSilo(
    <LibraryScreen
      kind="movie"
      memory={new LibraryMemory()}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
      onOpenCollection={vi.fn()}
    />,
    { session },
  );
}

const one = catalogItem({ content_id: 'one', title: 'One' });
const two = catalogItem({ content_id: 'two', title: 'Two' });
const card = (row: string, id: string) =>
  document.querySelector(`[data-focus-key="${cardFocusKey(`lib-1/${row}`, id)}"]`);

const sections = () => ({
  sections: {
    'lib-1': [
      homeSection('top', 1, { items: [one] }),
      homeSection('marked', 1, { section_type: 'marked', items: [one, two], total_count: 2 }),
      homeSection('plain', 1, { section_type: 'plain', items: [one] }),
    ],
  },
});

describe('the library rows: cards a row above already shows', () => {
  it('drops the card from a row of a marked type and keeps it in the other rows', async () => {
    serveLibrary(server, sections());
    serveRecipes(server, ['marked']);
    render();
    await screen.findByTestId('row-lib-1/marked');
    await waitFor(() => expect(card('marked', 'one')).toBeNull());
    expect(card('marked', 'two')).not.toBeNull();
    expect(card('top', 'one')).not.toBeNull();
    expect(card('plain', 'one')).not.toBeNull();
  });

  it('shows every row as served while the gallery is pending', async () => {
    serveLibrary(server, sections());
    serveRecipes(server, 'pending');
    render();
    await screen.findByTestId('row-lib-1/marked');
    expect(card('marked', 'one')).not.toBeNull();
  });

  it('shows every row as served when the gallery cannot be read', async () => {
    serveLibrary(server, sections());
    serveRecipes(server, 'fail');
    render();
    await screen.findByTestId('row-lib-1/marked');
    // Let the failed read settle: the rows must stay whole.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(card('marked', 'one')).not.toBeNull();
  });
});
