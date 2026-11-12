import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { serveSettings } from '../../test/settingsFixtures';
import { holdAnswers, signedInSession } from '../../test/spoilerFixtures';
import { LandscapeCard, PosterCard } from './Cards';
import type { CatalogItem } from './cardInfo';

// The overlay badges and the watch status on cards. Real timers: the settings and the server's
// defaults come through MSW and React Query.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const open = () => undefined;
const state = { in_watchlist: false, is_favorite: false, not_interested: false };

/** A movie with the file data the default badges show. */
const movie = catalogItem({
  title: 'Heat',
  overlay_summary: { resolution: '1080p', hdr: 'DV', audio: 'EAC3', release_type: 'BluRay' },
});

const poster = (item: CatalogItem = movie, props: { badge?: string } = {}) =>
  renderWithSilo(<PosterCard item={item} focusKey="c" onOpen={open} {...props} />, {
    session: signedInSession(),
  });
const landscape = (item: CatalogItem = movie) =>
  renderWithSilo(<LandscapeCard item={item} focusKey="c" onOpen={open} />, {
    session: signedInSession(),
  });

const badgeTexts = () => screen.queryAllByTestId('card-badge').map((el) => el.textContent);
const stack = (position: string) => document.querySelector(`.badge-stack-${position}`);

/** The document the server (or a profile) stores: version 2 with only the named ids changed. */
const document2 = (
  items: Record<string, { enabled?: boolean; position?: string; showIcon?: boolean }>,
) => ({
  version: 2,
  preset: 'classic',
  order: [],
  items,
});

describe('card badges', () => {
  it('draws the default badges of a poster once the settings are known', async () => {
    serveSettings(server);
    poster();
    await waitFor(() => expect(badgeTexts()).toEqual(['1080p', 'DV', 'EAC3', 'BluRay']));
    expect(stack('top-left')).toHaveTextContent('1080pDVEAC3');
    expect(stack('bottom-left')).toHaveTextContent('BluRay');
  });

  it('keeps the layer out of the way: not focusable, hidden from assistive technology, card name unchanged', async () => {
    serveSettings(server);
    poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    const layer = document.querySelector('.card-badges')!;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.querySelectorAll('[tabindex], button, a')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Heat 2019$|^Heat2019$/ })).toBeInTheDocument();
  });

  it('draws no badge while the profile settings or the defaults are still being read', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate });
    poster();
    // Neither the registry's defaults nor anything else flashes up first.
    expect(badgeTexts()).toEqual([]);
    await release();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
  });

  it('draws no badge when the profile switched them off, and still shows the watch status', async () => {
    const calls = serveSettings(server, { values: { 'ui.card_overlays_enabled': false } });
    poster(catalogItem({ ...movie, user_state: { ...state, played: true } }));
    await screen.findByTestId('watch-status-done');
    await waitFor(() => expect(calls.overlayConfig).toHaveLength(1));
    expect(badgeTexts()).toEqual([]);
  });

  it('follows the server defaults when the profile has no preference', async () => {
    serveSettings(server, {
      overlayConfig: { defaults: JSON.stringify(document2({ resolution: { enabled: false } })) },
    });
    poster();
    await waitFor(() => expect(badgeTexts()).toEqual(['DV', 'EAC3', 'BluRay']));
  });

  it("lets the profile's own document win over the server's", async () => {
    serveSettings(server, {
      values: { 'ui.card_overlays': document2({ audio: { enabled: false } }) },
      overlayConfig: { defaults: JSON.stringify(document2({ resolution: { enabled: false } })) },
    });
    poster();
    await waitFor(() => expect(badgeTexts()).toEqual(['1080p', 'DV', 'BluRay']));
  });

  it('inherits a server that has the badges off, and lets the profile switch them on', async () => {
    serveSettings(server, { overlayConfig: { enabled: false } });
    const off = poster();
    await waitFor(() => expect(screen.getByTestId('card-title')).toBeInTheDocument());
    // Give the reads time to settle before asserting that nothing appears.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(badgeTexts()).toEqual([]);
    off.unmount();

    serveSettings(server, {
      values: { 'ui.card_overlays_enabled': true },
      overlayConfig: { enabled: false },
    });
    poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
  });

  it('falls back to the registry defaults when the defaults cannot be read', async () => {
    serveSettings(server, { overlayConfig: 'fail' });
    poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
  });

  it('asks for nothing and draws nothing without a profile', async () => {
    const calls = serveSettings(server);
    renderWithSilo(<PosterCard item={movie} focusKey="c" onOpen={open} />);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(badgeTexts()).toEqual([]);
    expect(calls.overlayConfig).toHaveLength(0);
  });

  it('draws nothing in the top-right of a card: the stacks are the five other positions', async () => {
    serveSettings(server, {
      values: {
        'ui.card_overlays': document2({
          resolution: { position: 'top-right' },
          year: { enabled: true, position: 'top-right' },
        }),
      },
    });
    poster(catalogItem({ ...movie, year: 2019 }));
    await waitFor(() => expect(stack('right-edge')).not.toBeNull());
    expect(stack('top-right')).toBeNull();
    expect(stack('right-edge')).toHaveTextContent('1080p2019');
  });

  it('leaves the top-left to a label the card carries, and keeps the other stacks', async () => {
    serveSettings(server);
    poster(movie, { badge: 'THIS FILM' });
    await waitFor(() => expect(badgeTexts()).toEqual(['BluRay']));
    expect(screen.getByTestId('card-pill-start')).toHaveTextContent('THIS FILM');
  });

  it('shares the width between the bottom corners only when both are in use', async () => {
    serveSettings(server);
    const alone = poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(document.querySelector('.card-badges')).not.toHaveClass('card-badges-split');
    alone.unmount();

    serveSettings(server, {
      values: { 'ui.card_overlays': document2({ content_rating: { enabled: true } }) },
    });
    poster(catalogItem({ ...movie, content_rating: 'PG-13' }));
    await screen.findByText('PG-13');
    expect(document.querySelector('.card-badges')).toHaveClass('card-badges-split');
  });

  it('draws the layer on a landscape card too, and lifts the bottom stacks above its progress bar', async () => {
    serveSettings(server);
    landscape(catalogItem({ ...movie, position_seconds: 600, duration_seconds: 6000 }));
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(screen.getByTestId('card-progress')).toBeInTheDocument();
    expect(document.querySelector('.card-badges')).toHaveClass('card-badges-raised');
  });

  it('keeps the bottom stacks at the edge of a landscape card that has no progress bar', async () => {
    serveSettings(server);
    landscape();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(screen.queryByTestId('card-progress')).toBeNull();
    expect(document.querySelector('.card-badges')).not.toHaveClass('card-badges-raised');
  });

  it('draws no layer for an item without data for any badge', async () => {
    const calls = serveSettings(server);
    poster(catalogItem({ title: 'Plain' }));
    await waitFor(() => expect(calls.overlayConfig).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector('.card-badges')).toBeNull();
  });

  it('draws nothing until the server defaults have answered when the profile has no document', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { overlayGate: gate });
    poster();
    // The profile's own settings are in by now; only the defaults are missing.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(badgeTexts()).toEqual([]);
    await release();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
  });

  it('shows the registry defaults at once when the defaults answer 500, without retrying', async () => {
    const calls = serveSettings(server, { overlayConfig: 'fail' });
    // A client that would retry slowly: the read must not wait for it.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 60_000, gcTime: 0 } },
    });
    renderWithSilo(<PosterCard item={movie} focusKey="c" onOpen={open} />, {
      session: signedInSession(),
      queryClient,
    });
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(calls.overlayConfig).toHaveLength(1);
  });

  it('reads the server defaults once per profile', async () => {
    const calls = serveSettings(server);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const asProfile = (profileId: string) => {
      const session = new Session(memoryStorage());
      session.set({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 3600_000,
        user: account,
        profileId,
      });
      return session;
    };
    const first = renderWithSilo(<PosterCard item={movie} focusKey="c" onOpen={open} />, {
      session: asProfile('p1'),
      queryClient,
    });
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    first.unmount();
    renderWithSilo(<PosterCard item={movie} focusKey="c" onOpen={open} />, {
      session: asProfile('p2'),
      queryClient,
    });
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(calls.overlayConfig).toHaveLength(2);
  });

  it('does not ask a server below revision 8 for the switch, and lets that server decide it', async () => {
    const old = serveSettings(server, { manifestRevision: 7 });
    const view = poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    const keys = (calls: typeof old) =>
      new URL(calls.effective[0]!.url).searchParams.getAll('keys');
    expect(keys(old)).toContain('ui.card_overlays');
    expect(keys(old)).not.toContain('ui.card_overlays_enabled');
    view.unmount();

    // A server that has the badges off stays off on a revision 7 server: the profile cannot say.
    serveSettings(server, { manifestRevision: 7, overlayConfig: { enabled: false } });
    poster();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(badgeTexts()).toEqual([]);
    cleanup();

    const current = serveSettings(server, { manifestRevision: 8 });
    poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(keys(current)).toContain('ui.card_overlays_enabled');
  });

  it('draws a glyph before the text of a badge the document asks it for, and none for a wordmark', async () => {
    serveSettings(server, {
      values: {
        'ui.card_overlays': document2({
          resolution: { showIcon: true },
          hdr: { showIcon: true },
          audio: { showIcon: true },
          video_codec: { enabled: true, showIcon: true, position: 'bottom-right' },
        }),
      },
    });
    poster(
      catalogItem({
        ...movie,
        overlay_summary: { ...movie.overlay_summary, video_codec: 'AV1', audio: 'Atmos' },
      }),
    );
    await waitFor(() => expect(badgeTexts()).toHaveLength(5));
    const glyphs = (id: string) =>
      document.querySelector(`[data-badge="${id}"] svg`)?.getAttribute('data-glyph') ?? null;
    expect(glyphs('resolution')).toBe('monitor');
    // The web draws wordmarks (Dolby Vision, Atmos, AV1) as brand art; here those keep their text.
    expect(glyphs('hdr')).toBeNull();
    expect(glyphs('audio')).toBeNull();
    expect(glyphs('video_codec')).toBeNull();
    expect(screen.getByText('Atmos')).toBeInTheDocument();
    expect(document.querySelector('.badge svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the speaker for other audio and the film glyph for other codecs, and none when the document says no', async () => {
    serveSettings(server, {
      values: {
        'ui.card_overlays': document2({
          resolution: { showIcon: false },
          audio: { showIcon: true },
          video_codec: { enabled: true, showIcon: true, position: 'bottom-right' },
        }),
      },
    });
    poster(
      catalogItem({
        ...movie,
        overlay_summary: { ...movie.overlay_summary, video_codec: 'HEVC' },
      }),
    );
    await waitFor(() => expect(badgeTexts()).toHaveLength(5));
    const glyphs = (id: string) =>
      document.querySelector(`[data-badge="${id}"] svg`)?.getAttribute('data-glyph') ?? null;
    expect(glyphs('audio')).toBe('volume');
    expect(glyphs('video_codec')).toBe('film');
    expect(glyphs('resolution')).toBeNull();
  });

  it('draws the glyphs of a server whose defaults use the pill preset, with no showIcon', async () => {
    serveSettings(server, {
      overlayConfig: { defaults: JSON.stringify({ ...document2({}), preset: 'pill' }) },
    });
    poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    const glyph = (id: string) =>
      document.querySelector(`[data-badge="${id}"] svg`)?.getAttribute('data-glyph') ?? null;
    expect(glyph('resolution')).toBe('monitor');
    expect(glyph('audio')).toBe('volume');
    expect(glyph('hdr')).toBeNull();
    expect(glyph('release_type')).toBeNull();
  });

  it("draws no glyph by default (the web's classic look)", async () => {
    serveSettings(server);
    poster();
    await waitFor(() => expect(badgeTexts()).toHaveLength(4));
    expect(document.querySelector('.badge svg')).toBeNull();
  });

  it("tints a badge with its accent as a gradient over the pill's own fill", async () => {
    serveSettings(server, {
      values: { 'ui.card_overlays': document2({ rating_imdb: { enabled: true } }) },
    });
    poster(catalogItem({ ...movie, rating_imdb: 8.1 }));
    const badge = (await screen.findByText('IMDb 8.1')).closest<HTMLElement>('.badge')!;
    expect(badge.style.backgroundImage).toContain('linear-gradient');
    // The plain badges carry no inline tint.
    expect(screen.getByText('1080p').closest('.badge')!.getAttribute('style')).toBeNull();
  });
});

describe('the watch status', () => {
  it('shows a green check on a watched item', async () => {
    serveSettings(server);
    poster(catalogItem({ ...movie, user_state: { ...state, played: true } }));
    const done = await screen.findByTestId('watch-status-done');
    expect(done).toHaveAccessibleName('Watched');
    expect(screen.queryByTestId('watch-status-left')).toBeNull();
  });

  it('shows the episodes a started series has left, with plural forms', async () => {
    serveSettings(server);
    const view = poster(
      catalogItem({
        type: 'series',
        user_state: { ...state, played: false, watched_count: 2, unplayed_count: 5 },
      }),
    );
    const left = await screen.findByTestId('watch-status-left');
    expect(left).toHaveTextContent('5');
    expect(left).toHaveAccessibleName('5 episodes left');
    view.unmount();

    poster(
      catalogItem({
        type: 'series',
        user_state: { ...state, played: false, watched_count: 2, unplayed_count: 1 },
      }),
    );
    expect(await screen.findByTestId('watch-status-left')).toHaveAccessibleName('1 episode left');
  });

  it('shows the count in German', async () => {
    serveSettings(server);
    renderWithSilo(
      <PosterCard
        item={catalogItem({
          type: 'series',
          user_state: { ...state, played: false, watched_count: 1, unplayed_count: 4 },
        })}
        focusKey="c"
        onOpen={open}
      />,
      { session: signedInSession(), lang: 'de' },
    );
    expect(await screen.findByTestId('watch-status-left')).toHaveAccessibleName('4 Folgen übrig');
  });

  it('shows nothing for an untouched series, a finished count or an item without watch data', async () => {
    serveSettings(server);
    const items = [
      catalogItem({
        type: 'series',
        user_state: { ...state, played: false, watched_count: 0, unplayed_count: 8 },
      }),
      catalogItem({
        type: 'series',
        user_state: { ...state, played: false, watched_count: 3, unplayed_count: 0 },
      }),
      catalogItem({ type: 'series', user_state: { ...state, played: false } }),
      catalogItem({ type: 'series' }),
    ];
    for (const item of items) {
      const view = poster(item);
      await waitFor(() => expect(badgeTexts()).toEqual([]));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByTestId('watch-status-done')).toBeNull();
      expect(screen.queryByTestId('watch-status-left')).toBeNull();
      view.unmount();
    }
  });

  it('shows the check of a watched item rather than a count, even when episodes are left', async () => {
    serveSettings(server);
    poster(
      catalogItem({
        type: 'series',
        user_state: { ...state, played: true, watched_count: 3, unplayed_count: 2 },
      }),
    );
    await screen.findByTestId('watch-status-done');
    expect(screen.queryByTestId('watch-status-left')).toBeNull();
  });

  it('is on a landscape card too', async () => {
    serveSettings(server);
    landscape(catalogItem({ ...movie, user_state: { ...state, played: true } }));
    expect(await screen.findByTestId('watch-status-done')).toBeInTheDocument();
  });
});
