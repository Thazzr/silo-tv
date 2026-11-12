import { screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { signedInSession, spoilerValues } from '../../test/spoilerFixtures';
import { PORTRAIT_HASH, stubCanvas } from '../../test/thumbhashFixtures';
import { Hero } from './Hero';

// The carousel and spoiler protection. Real timers: the settings come through MSW and React Query.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  stubCanvas();
});
afterEach(() => vi.restoreAllMocks());

const episode = catalogItem({
  content_id: 'ep1',
  type: 'episode',
  title: 'Pilot',
  series_title: 'Severance',
  season_number: 1,
  episode_number: 3,
  overview: 'The twist is revealed.',
  backdrop_url: '/img/episode-still.webp',
  backdrop_thumbhash: PORTRAIT_HASH,
});
const movie = catalogItem({ content_id: 'm1', title: 'Heat', overview: 'A heist.' });

function renderCarousel(slides = [episode, movie]) {
  return renderWithSilo(
    <Hero
      item={null}
      featured={{ kind: 'slides', slides, onPlay: () => undefined, onOpen: () => undefined }}
    />,
    { session: signedInSession() },
  );
}

const activeImage = () =>
  document.querySelector<HTMLImageElement>('[data-testid="hero-slide"][data-active="true"] img');

describe('Carousel: spoiler protection', () => {
  it("leaves out an unwatched episode's description and shows a blurred stand-in for its still", async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    renderCarousel();
    await waitFor(() => expect(screen.queryByTestId('hero-synopsis')).toBeNull());
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Severance');
    // The still itself is never requested; the decoded ThumbHash takes its place.
    expect(document.querySelector('img[src$="episode-still.webp"]')).toBeNull();
    expect(activeImage()?.getAttribute('src')).toMatch(/^data:image\/png/);
  });

  it('shows the still and the description when the settings are off', async () => {
    const calls = serveSettings(server, { values: spoilerValues(false, false) });
    renderCarousel();
    await waitFor(() => expect(calls.effective).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('hero-synopsis')).toHaveTextContent('The twist is revealed.');
    expect(activeImage()?.getAttribute('src')).toBe(`${BASE_URL}/img/episode-still.webp`);
  });

  it('shows everything for a watched episode', async () => {
    const calls = serveSettings(server, { values: spoilerValues(true, true) });
    renderCarousel([{ ...episode, position_seconds: 300 }]);
    await waitFor(() => expect(calls.effective).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('hero-synopsis')).toBeInTheDocument();
    expect(activeImage()?.getAttribute('src')).toBe(`${BASE_URL}/img/episode-still.webp`);
  });

  it("uses the series' backdrop for an episode instead of its still", async () => {
    serveSettings(server, { values: spoilerValues(true, false) });
    renderCarousel([{ ...episode, series_backdrop_url: '/img/series-backdrop.webp' }]);
    await waitFor(() =>
      expect(activeImage()?.getAttribute('src')).toBe(`${BASE_URL}/img/series-backdrop.webp`),
    );
  });
});
