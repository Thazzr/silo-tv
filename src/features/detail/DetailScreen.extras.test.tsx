import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { getPlatform, setPlatformForTests, type OpenYouTubeResult } from '../../platform';
import { BASE_URL, account } from '../../test/apiFixtures';
import { episodeOf, itemDetail, seasonOf, serveDetail } from '../../test/detailFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';
import type { ItemExtra, ItemVideo } from './extras';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setPlatformForTests(null);
});
afterAll(() => server.close());

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

type Screen = { name: 'detail'; target: DetailTarget } | { name: 'player'; request: PlayRequest };

function setup(target: DetailTarget) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memory = new DetailMemory();
  const onPlay = vi.fn<(request: PlayRequest) => void>();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          onPlay(request);
          nav.push({ name: 'player', request });
        }}
        onOpenDetail={() => undefined}
        onOpenPerson={() => undefined}
        onOpenBoxSet={() => undefined}
        onBack={() => nav.pop()}
      />
    ) : (
      <div data-testid="player-stub">{current.request.contentId}</div>
    );
  render(
    <QueryClientProvider client={newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay };
}

const platformAnswering = (answer: OpenYouTubeResult) => {
  const openYouTubeVideo = vi.fn<(id: string) => Promise<OpenYouTubeResult>>(() =>
    Promise.resolve(answer),
  );
  setPlatformForTests({ ...getPlatform(), openYouTubeVideo });
  return openYouTubeVideo;
};

const extras: ItemExtra[] = [
  {
    content_id: 'local-1',
    kind: 'trailer',
    title: 'Official Trailer',
    duration_seconds: 125,
    still_url: '/img/x1.webp',
    still_thumbhash: 'KAhS8zzDGU8oXWtw6pMcVZjSZHc7jOEppvRQfTg=',
  },
  { content_id: 'local-2', kind: 'behind_the_scenes', duration_seconds: 3723 },
];
const videos: ItemVideo[] = [
  {
    site: 'youtube',
    site_key: 'dQw4w9WgXcQ',
    kind: 'teaser',
    is_official: true,
    name: 'The Teaser',
  },
  { site: 'youtube', site_key: 'abcdefghijk', kind: 'clip', is_official: false },
  { site: 'vimeo', site_key: 'vimeo123456', kind: 'trailer', is_official: true },
];

const ready = () => screen.findByTestId('row-extras');

describe('DetailScreen: Trailer & More', () => {
  it('has no row for a title without extras and videos', async () => {
    serveDetail(server, { item: () => itemDetail() });
    setup({ itemId: 'm1' });
    await screen.findByTestId('detail-hero');
    expect(screen.queryByTestId('row-extras')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Trailer & More' })).toBeNull();
  });

  it('shows the local extras first, then the YouTube videos, with captions and runtimes', async () => {
    serveDetail(server, { item: () => itemDetail({ extras, videos }) });
    setup({ itemId: 'm1' });
    const row = await ready();
    expect(screen.getByRole('heading', { name: 'Trailer & More' })).toBeInTheDocument();
    const titles = Array.from(row.querySelectorAll('[data-testid="extra-title"]')).map(
      (el) => el.textContent,
    );
    // A title, else the kind's label; the Vimeo video is not offered.
    expect(titles).toEqual(['Official Trailer', 'Behind the Scenes', 'The Teaser', 'Clip']);
    const runtimes = Array.from(row.querySelectorAll('[data-testid="extra-runtime"]')).map(
      (el) => el.textContent,
    );
    expect(runtimes).toEqual(['2:05', '1:02:03', 'Teaser', '']);
    // The first extra shows its own still.
    expect(row.querySelector(`img[src="${BASE_URL}/img/x1.webp"]`)).not.toBeNull();
  });

  it('marks YouTube cards with a YouTube pill and, when official, an Official pill', async () => {
    serveDetail(server, { item: () => itemDetail({ extras: [], videos }) });
    setup({ itemId: 'm1' });
    const row = await ready();
    const cards = row.querySelectorAll('.card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('.card-pill-start')).toHaveTextContent('YouTube');
    expect(cards[0]!.querySelector('.card-pill-end')).toHaveTextContent('Official');
    expect(cards[1]!.querySelector('.card-pill-start')).toHaveTextContent('YouTube');
    expect(cards[1]!.querySelector('.card-pill-end')).toBeNull();
  });

  it('never loads a picture from YouTube or Google; a YouTube card shows the title backdrop', async () => {
    serveDetail(server, {
      item: () => itemDetail({ extras: [], videos, backdrop_url: '/img/backdrop.webp' }),
    });
    setup({ itemId: 'm1' });
    const row = await ready();
    const sources = Array.from(document.querySelectorAll('[src], [href], [srcset]')).map(
      (el) => `${el.getAttribute('src')} ${el.getAttribute('href')} ${el.getAttribute('srcset')}`,
    );
    expect(sources.join(' ')).not.toMatch(/youtube|youtu\.be|ytimg|google|gstatic|ggpht/i);
    expect(row.querySelector(`img[src="${BASE_URL}/img/backdrop.webp"]`)).not.toBeNull();
  });

  it('puts the row after the cast and before the box set and similar titles (movie)', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          extras,
          cast: [{ name: 'First Actor', character: 'Fay', order: 0 }],
        }),
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One' })],
    });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByRole('button', { name: /Similar One/ });
    const zones = Array.from(document.querySelectorAll('[data-zone]')).map((el) =>
      el.getAttribute('data-zone'),
    );
    expect(zones).toEqual(['cast', 'extras', 'similar']);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:0-First Actor');
    await pressKey(KEY.down);
    await focusKeyIs('card:extras:local:local-1');
    await pressKey(KEY.right);
    await focusKeyIs('card:extras:local:local-2');
    await pressKey(KEY.down);
    await focusKeyIs('card:similar:x1');
    // The cast and the extras above the focus fade; the page is a zone of its own.
    expect(document.querySelector('[data-zone="extras"]')).toHaveAttribute('data-faded', 'true');
    await pressKey(KEY.up);
    await focusKeyIs('card:extras:local:local-2');
    expect(document.querySelector('[data-zone="cast"]')).toHaveAttribute('data-faded', 'true');
    expect(document.querySelector('[data-zone="extras"]')).toHaveAttribute('data-faded', 'false');
  });

  it('puts the row after the episodes of a series', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          play_content_id: 'e11',
          play_season_number: 1,
          extras,
        }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1), episodeOf(1, 2)],
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One', type: 'series' })],
    });
    setup({ itemId: 's1' });
    await ready();
    await screen.findByTestId('episode-strip');
    await screen.findByRole('button', { name: /Similar One/ });
    const zones = Array.from(document.querySelectorAll('[data-zone]')).map((el) =>
      el.getAttribute('data-zone'),
    );
    expect(zones).toEqual(['episodes', 'extras', 'similar']);
  });

  it('OK on a local extra plays it from its start, under its own content id and caption', async () => {
    serveDetail(server, { item: () => itemDetail({ extras }) });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('card:extras:local:local-1');
    await pressKey(KEY.enter);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'local-1',
      title: 'Official Trailer',
      intent: { kind: 'beginning' },
    });
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('local-1');
  });

  it('comes back from the player onto the same extra card', async () => {
    serveDetail(server, { item: () => itemDetail({ extras }) });
    setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('card:extras:local:local-2');
    await pressKey(KEY.enter);
    await screen.findByTestId('player-stub');
    await pressKey(KEY.back);
    await screen.findByTestId('row-extras');
    await focusKeyIs('card:extras:local:local-2');
  });

  it('OK on a YouTube card hands the video id to the platform and shows no notice when it opens', async () => {
    const open = platformAnswering('opened');
    serveDetail(server, { item: () => itemDetail({ videos }) });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /The Teaser/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('dQw4w9WgXcQ'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.queryByTestId('detail-notice')).toBeNull();
  });

  it('shows a short notice when the TV has no YouTube, and it goes away again', async () => {
    const open = platformAnswering('unavailable');
    serveDetail(server, { item: () => itemDetail({ videos }) });
    setup({ itemId: 'm1' });
    await ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(screen.getByRole('button', { name: /The Teaser/ }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(open).toHaveBeenCalledWith('dQw4w9WgXcQ');
      expect(screen.getByTestId('detail-notice')).toHaveTextContent(
        "YouTube isn't available on this TV.",
      );
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByTestId('detail-notice')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
