import { screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { episodeOf, rollup } from '../../test/detailFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { holdAnswers, signedInSession, spoilerValues } from '../../test/spoilerFixtures';
import { PORTRAIT_HASH, stubCanvas } from '../../test/thumbhashFixtures';
import { FocusIndexMemory } from '../../ui/media';
import { prefetchImage } from '../../ui/media/prefetch';
import { EpisodeGrid } from './EpisodeGrid';
import type { Episode } from './info';

vi.mock('../../ui/media/prefetch', () => ({ prefetchImage: vi.fn() }));

// Spoiler protection on the episode grid. Real timers: the settings come through
// MSW and React Query.
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

const STILL = `${BASE_URL}/img/still-`;
const PREVIEW = 'data:image/png;base64,14x32';

function episode(number: number, overrides: Partial<Episode> = {}): Episode {
  return episodeOf(1, number, {
    still_url: `/img/still-${number}.webp`,
    still_thumbhash: PORTRAIT_HASH,
    overview: `Secret of ${number}.`,
    ...overrides,
  });
}

function renderRow(episodes: Episode[]) {
  return renderWithSilo(
    <EpisodeGrid
      gridId="episodes:s1"
      episodes={episodes}
      memory={new FocusIndexMemory()}
      onOpen={() => undefined}
      onPlay={() => undefined}
      onFocused={() => undefined}
    />,
    { session: signedInSession() },
  );
}

const stillImages = () => document.querySelectorAll(`img[src^="${STILL}"]`);
const previews = () => document.querySelectorAll(`img[src="${PREVIEW}"]`);

describe('EpisodeGrid: spoiler protection', () => {
  it('shows an unwatched episode as its decoded preview and never requests the still', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    renderRow([episode(1)]);
    await waitFor(() => expect(previews()).toHaveLength(1));
    expect(stillImages()).toHaveLength(0);
    expect(screen.getByTestId('art-protected')).toBeInTheDocument();
  });

  it('replaces the description of an unwatched episode with the muted notice', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    renderRow([episode(1)]);
    const notice = await screen.findByTestId('episode-synopsis-hidden');
    expect(notice).toHaveTextContent('Description hidden');
    expect(screen.queryByTestId('episode-synopsis')).toBeNull();
    expect(screen.queryByText('Secret of 1.')).toBeNull();
  });

  it('hides the description alone when only that setting is on', async () => {
    serveSettings(server, { values: spoilerValues(false, true) });
    renderRow([episode(1)]);
    await screen.findByTestId('episode-synopsis-hidden');
    expect(stillImages()).toHaveLength(1);
    expect(previews()).toHaveLength(0);
  });

  it('blurs the still alone when only that setting is on', async () => {
    serveSettings(server, { values: spoilerValues(true, false) });
    renderRow([episode(1)]);
    await waitFor(() => expect(previews()).toHaveLength(1));
    expect(screen.getByTestId('episode-synopsis')).toHaveTextContent('Secret of 1.');
    expect(screen.queryByTestId('episode-synopsis-hidden')).toBeNull();
  });

  it('shows everything of watched, started and not-the-episodes-own-still rows', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    renderRow([
      episode(1, { user_data: rollup({ played: true }) }),
      episode(2, { user_data: rollup({ is_in_progress: true }) }),
      episode(3, { user_data: rollup({ position_seconds: 90 }) }),
      episode(4, { still_is_episode_still: false }),
    ]);
    // Wait for the answer to be applied: the fourth row (unwatched) hides its description.
    await waitFor(() => expect(screen.getAllByTestId('episode-synopsis-hidden')).toHaveLength(1));
    expect(stillImages()).toHaveLength(4);
    expect(previews()).toHaveLength(0);
    const first = within(screen.getByRole('button', { name: /Episode 1.1/ }));
    expect(first.getByTestId('episode-synopsis')).toHaveTextContent('Secret of 1.');
  });

  it('protects a still whose provenance is not reported', async () => {
    serveSettings(server, { values: spoilerValues(true, false) });
    renderRow([episode(1, { still_is_episode_still: undefined })]);
    await waitFor(() => expect(previews()).toHaveLength(1));
  });

  it('hides nothing while the settings are off', async () => {
    const calls = serveSettings(server, { values: spoilerValues(false, false) });
    renderRow([episode(1)]);
    await waitFor(() => expect(calls.effective).toHaveLength(1));
    await waitFor(() => expect(stillImages()).toHaveLength(1));
    expect(screen.getByTestId('episode-synopsis')).toHaveTextContent('Secret of 1.');
    expect(screen.queryByTestId('art-protected')).toBeNull();
  });

  it('hides nothing, and requests every still, until the settings are known', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate, values: spoilerValues(true, true) });
    renderRow([episode(1)]);
    expect(stillImages()).toHaveLength(1);
    expect(screen.getByTestId('episode-synopsis')).toHaveTextContent('Secret of 1.');
    await release();
    await screen.findByTestId('episode-synopsis-hidden');
    expect(previews()).toHaveLength(1);
  });

  it('shows the placeholder colour and an eye-off mark when the still has no thumbhash', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    renderRow([episode(1, { still_thumbhash: undefined })]);
    expect(await screen.findByTestId('art-hidden-mark')).toBeInTheDocument();
    expect(stillImages()).toHaveLength(0);
    expect(previews()).toHaveLength(0);
  });

  it('turns clear again when the setting is switched off', async () => {
    serveSettings(server, { values: spoilerValues(true, true) });
    const view = renderRow([episode(1)]);
    await waitFor(() => expect(previews()).toHaveLength(1));
    serveSettings(server, { values: spoilerValues(false, false) });
    await view.queryClient.invalidateQueries({ queryKey: ['settings'] });
    await waitFor(() => expect(stillImages()).toHaveLength(1));
    expect(screen.getByTestId('episode-synopsis')).toHaveTextContent('Secret of 1.');
  });

  it('does not prefetch the still of a protected episode, but the others', async () => {
    // Until the settings are known nothing is hidden, so the first prefetch is unprotected.
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate, values: spoilerValues(true, false) });
    // Thirty-six episodes: rows 4 and 5 (episodes 21 to 30) lie just past the mounted rows.
    const episodes = Array.from({ length: 36 }, (_, i) =>
      episode(i + 1, i === 25 ? { user_data: rollup({ played: true }) } : {}),
    );
    renderRow(episodes);
    vi.mocked(prefetchImage).mockClear();
    await release();
    const urls = () => vi.mocked(prefetchImage).mock.calls.map(([url]) => url);
    await waitFor(() => expect(urls()).toContain(`${STILL}26.webp`));
    expect(urls()).not.toContain(`${STILL}25.webp`);
  });
});
