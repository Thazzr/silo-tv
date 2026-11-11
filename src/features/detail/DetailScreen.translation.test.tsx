import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  episodeOf,
  itemDetail,
  seasonOf,
  serveDetail,
  type DetailCalls,
  type DetailServe,
} from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen } from './DetailScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

function setup(target: DetailTarget, queryClient: QueryClient = newQueryClient()) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memory = new DetailMemory();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator
            initial={{ name: 'detail', target }}
            renderScreen={(current, nav) => (
              <DetailScreen
                target={current.target}
                memory={memory.of(current)}
                onPlay={() => undefined}
                onOpenDetail={() => undefined}
                onOpenPerson={() => undefined}
                onOpenBoxSet={() => undefined}
                onBack={() => nav.pop()}
              />
            )}
          />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

// --- Fake timers: only the timeouts are faked, so the mock server still answers by itself --------

// The real timer, kept for yielding to the mock server while the clock is faked.
const realSetTimeout = globalThis.setTimeout;
const useClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await new Promise((resolve) => realSetTimeout(resolve, 2));
  });
/** Lets pending requests and renders finish without moving the clock. */
async function settle() {
  for (let i = 0; i < 12; i++) await flush(0);
}
/**
 * Moves the clock a second at a time and lets whatever each step set off finish: a run registers
 * its next wait only after its re-read came back, which takes real time the faked clock skips.
 */
async function advance(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await flush(1000);
    for (let n = 0; n < 4; n++) await flush(0);
  }
  await settle();
}
/** A long stretch in which nothing is expected to happen: one jump, then whatever it set off. */
async function quiet(seconds: number) {
  await flush(seconds * 1000);
  await settle();
}
async function until(check: () => void) {
  for (let i = 0; i < 200; i++) {
    try {
      check();
      return;
    } catch {
      // Now and then the clock moves a little: the app's own short timers (the navigation's
      // layout pass) need it. The drift stays far below a second.
      await flush(i % 10 === 9 ? 20 : 0);
    }
  }
  check();
}

// --- The scenario: a movie whose description is pending in German -------------------------------

const ORIGINAL = 'Original text.';
const TRANSLATED = 'Übersetzter Text.';

interface Scenario {
  on_view?: string;
  /** Re-reads after the request that still see the item pending; the next one sees it done. */
  pendingReads?: number;
  /** The server forgets the translation after it was done: later reads see it pending again. */
  forgets?: boolean;
  translate?: NonNullable<DetailServe['translation']>['translate'];
  capability?: NonNullable<DetailServe['translation']>['capability'];
}

function serveMovie(scenario: Scenario = {}) {
  const state = { readsAfterPost: 0, done: false, answeredDone: false };
  const posted = { value: false };
  const calls = serveDetail(server, {
    translation: {
      capability: scenario.capability ?? { on_view: scenario.on_view ?? 'auto' },
      translate: (id, body) => {
        posted.value = true;
        return scenario.translate?.(id, body) ?? {};
      },
    },
    item: (id) => {
      if (posted.value && !state.done) {
        state.readsAfterPost += 1;
        if (state.readsAfterPost > (scenario.pendingReads ?? 1)) state.done = true;
      }
      // With `forgets` only the read that completed the run sees the text.
      const sawDone = state.done && !state.answeredDone;
      if (state.done) state.answeredDone = true;
      if (state.done && (!scenario.forgets || sawDone)) {
        return itemDetail({
          content_id: id,
          overview: TRANSLATED,
          machine_translated_fields: ['overview'],
        });
      }
      return itemDetail({
        content_id: id,
        overview: ORIGINAL,
        pending_translation_language: 'de',
      });
    },
  });
  return { calls, state };
}

const synopsis = () => screen.getByTestId('detail-synopsis');
const line = () => screen.queryByTestId('detail-translation');
const pill = () => screen.queryByRole('button', { name: 'Translate description' });
const itemReads = (calls: DetailCalls) => calls.items.length;

describe('DetailScreen: AI translation of a description', () => {
  beforeEach(useClock);

  describe('auto mode', () => {
    it('asks once with the exact body, shows the state while it runs and the text when it is there', async () => {
      const { calls } = serveMovie({ pendingReads: 1 });
      setup({ itemId: 'm1' });
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      expect(calls.translation.posts[0]).toEqual({ id: 'm1', body: { target_language: 'de' } });
      expect(line()).toHaveTextContent('Translating…');
      expect(synopsis()).toHaveTextContent(ORIGINAL);
      expect(synopsis()).toHaveAttribute('data-dimmed', 'true');
      // No pill while a run is under way.
      expect(pill()).toBeNull();

      await advance(1); // the first re-read still sees it pending
      expect(synopsis()).toHaveTextContent(ORIGINAL);
      expect(line()).toHaveTextContent('Translating…');
      await advance(2); // the second one sees it done
      await until(() => expect(synopsis()).toHaveTextContent(TRANSLATED));
      expect(synopsis()).toHaveAttribute('data-dimmed', 'false');
      expect(line()).toHaveTextContent('Translated by AI');
      expect(pill()).toBeNull();
      expect(calls.translation.posts).toHaveLength(1);
      // It reads no more once the text is there.
      const reads = itemReads(calls);
      await quiet(60);
      expect(itemReads(calls)).toBe(reads);
    });

    it('does not ask again when the page is opened again after the run finished', async () => {
      const { calls } = serveMovie({ pendingReads: 0, forgets: true });
      const first = setup({ itemId: 'm1' });
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      await advance(1);
      // The run is over (it saw the text), though this server answers pending again afterwards.
      await until(() => expect(line()).toHaveTextContent('Translated by AI'));
      first.unmount();
      setup({ itemId: 'm1' }, first.queryClient);
      await until(() => expect(screen.getByTestId('detail-synopsis')).toHaveTextContent(ORIGINAL));
      await quiet(60);
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('does not start again by itself after a failed job, and offers the pill instead', async () => {
      const { calls } = serveMovie({ translate: () => ({ status: 'failed' }) });
      setup({ itemId: 'm1' });
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      await until(() => expect(pill()).not.toBeNull());
      expect(line()).toBeNull();
      expect(synopsis()).toHaveAttribute('data-dimmed', 'false');
      // A failed job is not read again.
      const reads = itemReads(calls);
      await quiet(60);
      expect(calls.translation.posts).toHaveLength(1);
      expect(itemReads(calls)).toBe(reads);
    });

    it('treats a canceled job like a failed one', async () => {
      const { calls } = serveMovie({ translate: () => ({ status: 'canceled' }) });
      setup({ itemId: 'm1' });
      await until(() => expect(pill()).not.toBeNull());
      await quiet(60);
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('gives up after 45 seconds of re-reading, twelve reads in all', async () => {
      const { calls } = serveMovie({ pendingReads: 1000 });
      setup({ itemId: 'm1' });
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      const before = itemReads(calls);
      await advance(44);
      expect(line()).toHaveTextContent('Translating…');
      expect(pill()).toBeNull();
      await advance(1);
      await until(() => expect(pill()).not.toBeNull());
      expect(line()).toBeNull();
      expect(itemReads(calls) - before).toBe(12);
      await quiet(60);
      expect(itemReads(calls) - before).toBe(12);
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('re-reads exactly once after a 422 and is done when the text is there', async () => {
      const { calls } = serveMovie({ pendingReads: 0, translate: () => ({ problem: 422 }) });
      setup({ itemId: 'm1' });
      await until(() => expect(synopsis()).toHaveTextContent(TRANSLATED));
      await settle();
      expect(line()).toHaveTextContent('Translated by AI');
      expect(calls.translation.posts).toHaveLength(1);
      // The initial read and the one re-read.
      expect(itemReads(calls)).toBe(2);
      await quiet(60);
      expect(itemReads(calls)).toBe(2);
    });

    it('fails after a 429 or 422 when the re-read still finds the text missing', async () => {
      const { calls } = serveMovie({ pendingReads: 1000, translate: () => ({ problem: 429 }) });
      setup({ itemId: 'm1' });
      await until(() => expect(pill()).not.toBeNull());
      expect(itemReads(calls)).toBe(2);
      await quiet(60);
      expect(itemReads(calls)).toBe(2);
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('fails on any other error without a re-read', async () => {
      const { calls } = serveMovie({ translate: () => ({ problem: 500 }) });
      setup({ itemId: 'm1' });
      await until(() => expect(pill()).not.toBeNull());
      await quiet(60);
      expect(itemReads(calls)).toBe(1);
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('stops all requests and timers when the page goes away mid-run', async () => {
      const { calls } = serveMovie({ pendingReads: 1000 });
      // The cache keeps the item after the page is gone, so a run left behind would still read it.
      const view = setup(
        { itemId: 'm1' },
        new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }),
      );
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      await advance(3); // two re-reads are in
      const reads = itemReads(calls);
      expect(reads).toBeGreaterThan(1);
      view.unmount();
      await quiet(120);
      expect(itemReads(calls)).toBe(reads);
      expect(calls.translation.posts).toHaveLength(1);
    });
  });

  describe('a series', () => {
    const series = () => itemDetail({ type: 'series', content_id: 's1', play_season_number: 1 });

    function serveSeries(seasons = [seasonOf(1)]) {
      const state = { posted: false, readsAfterPost: 0 };
      const calls = serveDetail(server, {
        translation: {
          capability: { on_view: 'auto' },
          translate: () => {
            state.posted = true;
            return {};
          },
        },
        item: () => series(),
        seasons,
        episodes: (season) => {
          if (season !== 1) return [episodeOf(season, 1)];
          if (state.posted) state.readsAfterPost += 1;
          const done = state.readsAfterPost >= 2;
          return [1, 2].map((n) =>
            episodeOf(1, n, done ? {} : { pending_translation_language: 'de' }),
          );
        },
      });
      return { calls, state };
    }
    const episodeReads = (calls: DetailCalls, key = 's1/1') =>
      calls.episodes.filter((read) => read === key).length;

    it('translates the listed season of a one-season series by its content id and the episodes language', async () => {
      const { calls } = serveSeries();
      setup({ itemId: 's1' });
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      expect(calls.translation.posts[0]).toEqual({
        id: 'season-1',
        body: { target_language: 'de' },
      });
      // The season's descriptions are not the item's: no line in the hero.
      expect(line()).toBeNull();
      const before = episodeReads(calls);
      await advance(1);
      expect(episodeReads(calls)).toBe(before + 1);
      await advance(2);
      expect(episodeReads(calls)).toBe(before + 2);
      // Done: nothing is pending any more, and nothing is read again.
      await quiet(60);
      expect(episodeReads(calls)).toBe(before + 2);
      expect(calls.translation.posts).toHaveLength(1);
      expect(pill()).toBeNull();
    });

    it('stops the run of the listed season when the seasons list grows and the page lists none', async () => {
      const { calls, state } = serveSeries();
      const queryClient = newQueryClient();
      setup({ itemId: 's1' }, queryClient);
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      // Keeps season 1 pending however often it is read.
      state.readsAfterPost = -1000;
      server.use(
        http.get(`${BASE_URL}/api/v2/catalog/series/:id/seasons`, () =>
          HttpResponse.json({ items: [seasonOf(1), seasonOf(2)] }),
        ),
      );
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['detail', 'seasons'] });
      });
      await settle();
      await until(() => expect(screen.getByTestId('season-rail')).toBeInTheDocument());
      const reads = episodeReads(calls);
      await quiet(60);
      // Stopped, not failed: no more reads, no pill, no second request.
      expect(episodeReads(calls)).toBe(reads);
      expect(pill()).toBeNull();
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('translates no season of a series that lists none: only the play target is read', async () => {
      const { calls } = serveSeries([seasonOf(1), seasonOf(2)]);
      setup({ itemId: 's1' });
      await until(() => expect(calls.episodes).toContain('s1/1'));
      await quiet(60);
      expect(calls.translation.posts).toEqual([]);
      expect(pill()).toBeNull();
    });
  });

  describe('a season page', () => {
    const seasonPage = (overrides = {}) =>
      itemDetail({
        type: 'season',
        content_id: 'season-1',
        series_id: 's1',
        series_title: 'A Show',
        season_number: 1,
        ...overrides,
      });

    function serveSeasonPage(overrides = {}) {
      const state = { posted: false, readsAfterPost: 0 };
      const calls = serveDetail(server, {
        translation: {
          capability: { on_view: 'auto' },
          translate: () => {
            state.posted = true;
            return {};
          },
        },
        item: () => seasonPage(overrides),
        episodes: () => {
          if (state.posted) state.readsAfterPost += 1;
          const done = state.readsAfterPost >= 2;
          return [1, 2].map((n) =>
            episodeOf(1, n, done ? {} : { pending_translation_language: 'de' }),
          );
        },
      });
      return { calls, state };
    }

    it('translates the episodes of the season by the season content id, reading its list again', async () => {
      const { calls } = serveSeasonPage();
      setup({ itemId: 'season-1' });
      await until(() => expect(calls.translation.posts).toHaveLength(1));
      await settle();
      expect(calls.translation.posts[0]).toEqual({
        id: 'season-1',
        body: { target_language: 'de' },
      });
      const reads = () => calls.episodes.filter((read) => read === 's1/1').length;
      const before = reads();
      await advance(1);
      expect(reads()).toBe(before + 1);
      await advance(2);
      expect(reads()).toBe(before + 2);
      await quiet(60);
      expect(reads()).toBe(before + 2);
      expect(calls.translation.posts).toHaveLength(1);
    });

    it('translates the season overview and the episodes as two runs of their own', async () => {
      const { calls } = serveSeasonPage({ pending_translation_language: 'de' });
      setup({ itemId: 'season-1' });
      await until(() => expect(calls.translation.posts).toHaveLength(2));
      expect(calls.translation.posts.map((post) => post.id)).toEqual(['season-1', 'season-1']);
    });
  });

  describe('when the server does not offer it', () => {
    it.each<[string, Scenario]>([
      ['the mode is off', { on_view: 'off' }],
      ['the mode is unknown', { on_view: 'whenever' }],
      ['the principal is not allowed', { capability: { on_view: 'auto', allowed: false } }],
      ['the capability is unsupported', { capability: { on_view: 'auto', state: 'unsupported' } }],
      [
        'the capability is not configured',
        { capability: { on_view: 'auto', state: 'not_configured' } },
      ],
      ['the capability read fails', { capability: 'fail' }],
    ])('asks for nothing and shows nothing when %s', async (_name, scenario) => {
      const { calls } = serveMovie(scenario);
      setup({ itemId: 'm1' });
      await until(() => expect(calls.translation.capabilities).toBeGreaterThan(0));
      await settle();
      await quiet(60);
      expect(calls.translation.posts).toEqual([]);
      expect(pill()).toBeNull();
      expect(line()).toBeNull();
      expect(synopsis()).toHaveAttribute('data-dimmed', 'false');
    });

    it('shows "Translated by AI" under a description that was machine-translated earlier', async () => {
      serveDetail(server, {
        item: () => itemDetail({ machine_translated_fields: ['overview'] }),
      });
      setup({ itemId: 'm1' });
      await until(() => expect(line()).toHaveTextContent('Translated by AI'));
    });

    it('has no line for a tagline that was machine-translated alone', async () => {
      serveDetail(server, { item: () => itemDetail({ machine_translated_fields: ['tagline'] }) });
      setup({ itemId: 'm1' });
      await until(() => expect(screen.getByTestId('detail-hero')).toBeInTheDocument());
      expect(line()).toBeNull();
    });
  });

  it('shows no pill in button mode when nothing is pending', async () => {
    const calls = serveDetail(server, {
      translation: { capability: { on_view: 'button' } },
      item: () => itemDetail(),
    });
    setup({ itemId: 'm1' });
    await until(() => expect(calls.translation.capabilities).toBeGreaterThan(0));
    await settle();
    expect(pill()).toBeNull();
  });
});

describe('DetailScreen: translation on request (button mode)', () => {
  it('offers the pill without asking, and OK runs the translation and hands the focus to Play', async () => {
    const { calls } = serveMovie({ on_view: 'button', pendingReads: 0 });
    setup({ itemId: 'm1' });
    await waitFor(() => expect(pill()).not.toBeNull());
    await waitFor(() => expect(getCurrentFocusKey()).toBe('detail-play'));
    expect(calls.translation.posts).toEqual([]);
    expect(line()).toBeNull();

    // Play, watched, favourite, rating, More, then the pill.
    for (let i = 0; i < 5; i += 1) await pressKey(KEY.right);
    await waitFor(() => expect(getCurrentFocusKey()).toBe('detail-translate'));
    await pressKey(KEY.enter);
    await waitFor(() => expect(getCurrentFocusKey()).toBe('detail-play'));
    expect(pill()).toBeNull();
    await waitFor(() => expect(calls.translation.posts).toHaveLength(1));
    expect(calls.translation.posts[0]).toEqual({ id: 'm1', body: { target_language: 'de' } });
    expect(getCurrentFocusKey()).toBe('detail-play');
    // The first re-read comes after one second.
    await waitFor(() => expect(synopsis()).toHaveTextContent(TRANSLATED), { timeout: 4000 });
    expect(line()).toHaveTextContent('Translated by AI');
    expect(pill()).toBeNull();
    expect(getCurrentFocusKey()).toBe('detail-play');
  });

  it('brings the pill back after a failed run', async () => {
    const { calls } = serveMovie({ on_view: 'button', translate: () => ({ problem: 500 }) });
    setup({ itemId: 'm1' });
    const first = await screen.findByRole('button', { name: 'Translate description' });
    fireEvent.click(first);
    await waitFor(() => expect(calls.translation.posts).toHaveLength(1));
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(line()).toBeNull();
    // Another try asks again.
    fireEvent.click(screen.getByRole('button', { name: 'Translate description' }));
    await waitFor(() => expect(calls.translation.posts).toHaveLength(2));
  });
});
