import { act, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { holdAnswers, signedInSession, spoilerValues } from '../../test/spoilerFixtures';
import { PORTRAIT_HASH, stubCanvas } from '../../test/thumbhashFixtures';
import { CatalogRow } from './CatalogRow';
import { LandscapeCard, PosterCard } from './Cards';
import { prefetchImage } from './prefetch';
import type { CatalogItem } from './cardInfo';

vi.mock('./prefetch', () => ({ prefetchImage: vi.fn() }));

// Spoiler protection on cards. Real timers: the settings come through MSW and React Query.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());
beforeEach(() => {
  stubCanvas();
});

const PREVIEW = 'data:image/png;base64,14x32';
const stillImages = () => document.querySelectorAll(`img[src="${BASE_URL}/img/still.webp"]`);
const previews = () => document.querySelectorAll(`img[src="${PREVIEW}"]`);

const nextUp = catalogItem({
  content_id: 'ep1',
  type: 'episode',
  title: 'Pilot',
  series_title: 'Severance',
  season_number: 1,
  episode_number: 1,
  item_source: 'next_up',
  backdrop_url: '/img/still.webp',
  backdrop_thumbhash: PORTRAIT_HASH,
  backdrop_is_episode_still: true,
});

const open = () => undefined;
const landscape = (item: CatalogItem) =>
  renderWithSilo(<LandscapeCard item={item} focusKey="c" onOpen={open} />, {
    session: signedInSession(),
  });

describe('cards: spoiler protection', () => {
  it('blurs a Next Up card: its preview shows and the still is never requested', async () => {
    serveSettings(server, { values: spoilerValues(true, false) });
    landscape(nextUp);
    await waitFor(() => expect(previews()).toHaveLength(1));
    expect(stillImages()).toHaveLength(0);
    // The caption and the frame stay as they are.
    expect(screen.getByTestId('card-title')).toHaveTextContent('Severance');
    expect(screen.getByTestId('card-episode')).toHaveTextContent('Season 1 Episode 1 • Pilot');
  });

  it('shows the still of a watched, started or not-an-episode-still card', async () => {
    const calls = serveSettings(server, { values: spoilerValues(true, true) });
    const state = { in_watchlist: false, is_favorite: false, not_interested: false };
    const items = [
      { ...nextUp, user_state: { ...state, played: true } },
      { ...nextUp, position_seconds: 120 },
      { ...nextUp, backdrop_is_episode_still: false },
    ];
    for (const item of items) {
      const view = landscape(item);
      await waitFor(() => expect(calls.effective.length).toBeGreaterThan(0));
      await waitFor(() => expect(stillImages()).toHaveLength(1));
      expect(previews()).toHaveLength(0);
      view.unmount();
    }
  });

  it('keeps the series backdrop that a card falls back to', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    landscape({ ...nextUp, backdrop_url: undefined, series_backdrop_url: '/img/still.webp' });
    await waitFor(() => expect(stillImages()).toHaveLength(1));
    expect(previews()).toHaveLength(0);
  });

  it('blurs a poster card whose picture is the episode still, but not a series poster', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    const own = catalogItem({
      type: 'episode',
      title: 'Pilot',
      poster_url: '/img/still.webp',
      poster_thumbhash: PORTRAIT_HASH,
    });
    const view = renderWithSilo(<PosterCard item={own} focusKey="p" onOpen={open} />, {
      session: signedInSession(),
    });
    await waitFor(() => expect(previews()).toHaveLength(1));
    expect(stillImages()).toHaveLength(0);
    view.unmount();
    renderWithSilo(
      <PosterCard
        item={{ ...own, series_poster_url: '/img/still.webp' }}
        focusKey="p"
        onOpen={open}
      />,
      { session: signedInSession() },
    );
    await waitFor(() => expect(stillImages()).toHaveLength(1));
    expect(previews()).toHaveLength(0);
  });

  it('never blurs a movie', async () => {
    const calls = serveSettings(server, { values: spoilerValues(true, true) });
    renderWithSilo(
      <PosterCard
        item={catalogItem({ poster_url: '/img/still.webp', poster_thumbhash: PORTRAIT_HASH })}
        focusKey="p"
        onOpen={open}
      />,
      { session: signedInSession() },
    );
    await waitFor(() => expect(calls.effective.length).toBeGreaterThan(0));
    expect(stillImages()).toHaveLength(1);
    expect(previews()).toHaveLength(0);
  });

  it('shows the still while the setting is off', async () => {
    const calls = serveSettings(server, { values: spoilerValues(false, true) });
    landscape(nextUp);
    await waitFor(() => expect(calls.effective).toHaveLength(1));
    expect(stillImages()).toHaveLength(1);
    expect(previews()).toHaveLength(0);
  });

  it('shows the still when the server has no settings contract', async () => {
    serveSettings(server, { capabilities: 'fail' });
    landscape(nextUp);
    await waitFor(() => expect(stillImages()).toHaveLength(1));
    expect(previews()).toHaveLength(0);
  });

  it('turns clear as soon as the episode is marked watched, and blurs again when it is not', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    let mark!: (played: boolean) => void;
    function Harness() {
      const [played, setPlayed] = useState(false);
      mark = setPlayed;
      const state = { in_watchlist: false, is_favorite: false, not_interested: false };
      return (
        <LandscapeCard
          item={{ ...nextUp, user_state: { ...state, played } }}
          focusKey="c"
          onOpen={open}
        />
      );
    }
    renderWithSilo(<Harness />, { session: signedInSession() });
    await waitFor(() => expect(previews()).toHaveLength(1));
    act(() => mark(true));
    expect(stillImages()).toHaveLength(1);
    expect(previews()).toHaveLength(0);
    act(() => mark(false));
    expect(previews()).toHaveLength(1);
    expect(stillImages()).toHaveLength(0);
  });

  it('does not prefetch the still of a protected card, but the others', async () => {
    // Until the settings are known nothing is hidden, so the first prefetch is unprotected.
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate, values: spoilerValues(true, false) });
    const watched = {
      ...nextUp,
      content_id: 'ep2',
      position_seconds: 60,
      backdrop_url: '/img/other.webp',
    };
    const row = (
      <CatalogRow
        rowId="next"
        title="Next up"
        shape="landscape"
        items={[nextUp, watched]}
        hasMore={false}
        mounted={false}
        prefetchRow
        rowIndex={0}
        onOpen={open}
        onExploreAll={open}
        onRowFocused={open}
      />
    );
    renderWithSilo(row, { session: signedInSession() });
    vi.mocked(prefetchImage).mockClear();
    await release();
    await waitFor(() =>
      expect(vi.mocked(prefetchImage).mock.calls.map(([url]) => url)).toContain(
        `${BASE_URL}/img/other.webp`,
      ),
    );
    expect(vi.mocked(prefetchImage).mock.calls.map(([url]) => url)).not.toContain(
      `${BASE_URL}/img/still.webp`,
    );
  });
});
