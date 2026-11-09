import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account, problem } from '../../test/apiFixtures';
import { catalogItem, catalogPage } from '../../test/flowFixtures';
import { serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { FocusIndexMemory, gridCardKey, type CatalogItem } from '../../ui/media';
import { getCurrentFocusKey } from '../../app/nav';
import { SectionGridScreen } from './SectionGridScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup(memory = new FocusIndexMemory()) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const onPlay = vi.fn<(item: CatalogItem) => void>();
  const onBack = vi.fn();
  const view = renderWithSilo(
    <SectionGridScreen
      sectionId="trending"
      title="Trending now"
      memory={memory}
      onPlay={onPlay}
      onBack={onBack}
    />,
    { session },
  );
  return { onPlay, onBack, memory, ...view };
}

const titles = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) =>
    catalogItem({ content_id: `t${from + i + 1}`, title: `Title ${from + i + 1}` }),
  );

/** Pages of 30 with a cursor each, 70 titles in all. */
function pages(calls: { cursor: string | null }[]) {
  return (params: URLSearchParams) => {
    const cursor = params.get('cursor');
    calls.push({ cursor });
    if (cursor === null) {
      return { ...catalogPage(titles(0, 30)), page: { has_more: true, next_cursor: 'c2' } };
    }
    if (cursor === 'c2') {
      return { ...catalogPage(titles(30, 60)), page: { has_more: true, next_cursor: 'c3' } };
    }
    return { ...catalogPage(titles(60, 70)), page: { has_more: false } };
  };
}

const down = async (times: number) => {
  for (let i = 0; i < times; i += 1) await pressKey(KEY.down);
};

describe('SectionGridScreen', () => {
  it('shows the row title and a grid skeleton while the first page loads', async () => {
    serveHome(server, {
      page: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return catalogPage(titles(0, 12));
      },
    });
    setup();
    expect(screen.getByTestId('section-grid-title')).toHaveTextContent('Trending now');
    expect(screen.getByTestId('grid-skeleton')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('grid-skeleton')).toBeNull());
    expect(await screen.findByTestId('grid-viewport')).toBeInTheDocument();
  });

  it('reads the row through the catalog with the section, the page size and the poster width', async () => {
    const seen: { cursor: string | null }[] = [];
    const calls = serveHome(server, { page: pages(seen) });
    setup();
    await waitFor(() =>
      expect(
        document.querySelector(`[data-focus-key="${gridCardKey('trending', 't1')}"]`),
      ).not.toBeNull(),
    );
    const query = calls.pages[0]!;
    expect(query.get('source')).toBe('section');
    expect(query.get('scope')).toBe('home');
    expect(query.get('section_id')).toBe('trending');
    expect(query.get('limit')).toBe('40');
    expect(query.get('poster_width')).toBe('520');
    expect(query.has('cursor')).toBe(false);
  });

  it('follows the cursor before the end and stops at the last page', async () => {
    const seen: { cursor: string | null }[] = [];
    serveHome(server, { page: pages(seen) });
    setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe(gridCardKey('trending', 't1')));
    expect(seen).toEqual([{ cursor: null }]);
    // Row 2 of 5: twelve cards from the end of 30 is three rows away.
    await down(2);
    await waitFor(() => expect(seen).toEqual([{ cursor: null }, { cursor: 'c2' }]));
    await down(5);
    await waitFor(() => expect(seen.map((c) => c.cursor)).toEqual([null, 'c2', 'c3']));
    // All 70 are there: moving to the end asks for nothing more.
    await down(8);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(seen).toHaveLength(3);
    expect(getCurrentFocusKey()).toBe(gridCardKey('trending', 't67'));
  });

  it('shows an error with Try again when the first page fails, and recovers', async () => {
    serveHome(server, { page: () => new HttpResponse(null, { status: 500 }) });
    setup();
    const error = await screen.findByTestId('grid-error');
    expect(error).toHaveTextContent('The titles could not be loaded.');
    serveHome(server, { page: () => catalogPage(titles(0, 12)) });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(
        document.querySelector(`[data-focus-key="${gridCardKey('trending', 't1')}"]`),
      ).not.toBeNull(),
    );
  });

  it('says the row is gone on a 404 and offers Back', async () => {
    serveHome(server, {
      page: () =>
        HttpResponse.json(problem('not_found', 404), {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
    });
    const { onBack } = setup();
    expect(await screen.findByTestId('grid-error')).toHaveTextContent(
      'This row is no longer available.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('says so when the row is empty', async () => {
    serveHome(server, { page: () => catalogPage([]) });
    setup();
    expect(await screen.findByTestId('grid-empty')).toHaveTextContent('has nothing in it');
  });

  it('plays a movie with OK', async () => {
    serveHome(server, { page: () => catalogPage(titles(0, 12)) });
    const { onPlay } = setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe(gridCardKey('trending', 't1')));
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ content_id: 't2' }));
  });

  it('opens at the remembered card', async () => {
    serveHome(server, { page: () => catalogPage(titles(0, 30)) });
    const memory = new FocusIndexMemory();
    memory.set('trending', 13);
    setup(memory);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(gridCardKey('trending', 't14')));
  });
});
