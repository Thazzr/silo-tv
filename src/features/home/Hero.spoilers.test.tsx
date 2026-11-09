import { screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { holdAnswers, signedInSession, spoilerValues } from '../../test/spoilerFixtures';
import { Hero } from './Hero';

// The Home hero and spoiler protection. Real timers: the settings come through MSW and React Query.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const episode = catalogItem({
  content_id: 'ep1',
  type: 'episode',
  title: 'Pilot',
  series_title: 'Severance',
  season_number: 1,
  episode_number: 3,
  overview: 'The twist is revealed.',
  backdrop_url: '/img/episode-still.webp',
});
const STILL = `${BASE_URL}/img/episode-still.webp`;
const SERIES = `${BASE_URL}/img/series-backdrop.webp`;

const renderHero = (item: typeof episode) =>
  renderWithSilo(<Hero item={item} />, { session: signedInSession() });

describe('Hero: spoiler protection', () => {
  it('shows neither the own still nor the overview of an unwatched episode, but title and line', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    renderHero(episode);
    await waitFor(() => expect(screen.queryByTestId('hero-backdrop')).toBeNull());
    expect(screen.queryByTestId('hero-synopsis')).toBeNull();
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Severance');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('S1 · E3');
  });

  it('uses the series backdrop when the item offers one', async () => {
    serveSettings(server, { values: spoilerValues(true, false) });
    renderHero({ ...episode, series_backdrop_url: '/img/series-backdrop.webp' });
    await screen.findByTestId('hero-backdrop');
    expect(screen.getByTestId('hero-backdrop')).toHaveAttribute('src', SERIES);
    expect(screen.getByTestId('hero-synopsis')).toHaveTextContent('The twist is revealed.');
  });

  it('hides the overview alone when only that setting is on', async () => {
    serveSettings(server, { values: spoilerValues(false, true) });
    renderHero(episode);
    await waitFor(() => expect(screen.queryByTestId('hero-synopsis')).toBeNull());
    expect(screen.getByTestId('hero-backdrop')).toHaveAttribute('src', STILL);
  });

  it('shows everything for a watched episode', async () => {
    const calls = serveSettings(server, { values: spoilerValues(true, true) });
    renderHero({ ...episode, position_seconds: 300 });
    await waitFor(() => expect(calls.effective).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('hero-backdrop')).toHaveAttribute('src', STILL);
    expect(screen.getByTestId('hero-synopsis')).toBeInTheDocument();
  });

  it('never touches a movie', async () => {
    const calls = serveSettings(server, { values: spoilerValues(true, true) });
    renderHero(
      catalogItem({ title: 'Heat', overview: 'A heist.', backdrop_url: '/img/episode-still.webp' }),
    );
    await waitFor(() => expect(calls.effective).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('hero-backdrop')).toHaveAttribute('src', STILL);
    expect(screen.getByTestId('hero-synopsis')).toBeInTheDocument();
  });

  it('hides nothing until the settings are known', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate, values: spoilerValues(true, true) });
    renderHero(episode);
    expect(screen.getByTestId('hero-backdrop')).toHaveAttribute('src', STILL);
    expect(screen.getByTestId('hero-synopsis')).toBeInTheDocument();
    await release();
    await waitFor(() => expect(screen.queryByTestId('hero-backdrop')).toBeNull());
  });
});
