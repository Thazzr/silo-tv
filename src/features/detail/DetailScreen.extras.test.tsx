import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider, type Language } from '../../i18n';
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

function setup(target: DetailTarget, lang: Language = 'en') {
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
      <I18nProvider lang={lang}>
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
// Two trailers and a second kind, for the grouping.
const allExtras: ItemExtra[] = [
  ...extras.slice(0, 1),
  { content_id: 'local-3', kind: 'trailer' },
  ...extras.slice(1),
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

const ready = () => screen.findByTestId('detail-extras');
const trailers = () => screen.findByTestId('row-trailers');
const rowOf = (kind: string) => screen.getByTestId(`row-extras-${kind}`);
const titlesIn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('[data-testid="extra-title"]')).map((el) => el.textContent);
const zones = () =>
  Array.from(document.querySelectorAll('[data-zone]')).map((el) => el.getAttribute('data-zone'));

describe('DetailScreen: Extras', () => {
  it('has no Extras section and no Trailers & More row for a title without either', async () => {
    serveDetail(server, { item: () => itemDetail() });
    setup({ itemId: 'm1' });
    await screen.findByTestId('detail-hero');
    expect(screen.queryByTestId('detail-extras')).toBeNull();
    expect(screen.queryByTestId('row-trailers')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Extras' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Trailers & More' })).toBeNull();
  });

  it('shows one row per kind under its own heading, in the server order, with title and runtime', async () => {
    serveDetail(server, { item: () => itemDetail({ extras: allExtras, videos }) });
    setup({ itemId: 'm1' });
    const section = await ready();
    expect(within(section).getByRole('heading', { name: 'Extras' })).toBeInTheDocument();
    const rows = Array.from(section.querySelectorAll('.row-section')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(rows).toEqual(['row-extras-trailer', 'row-extras-behind_the_scenes']);
    expect(Array.from(section.querySelectorAll('.row-title')).map((el) => el.textContent)).toEqual([
      'Trailers',
      'Behind the Scenes',
    ]);
    // A title, else the kind's label (the singular one).
    expect(titlesIn(rowOf('trailer'))).toEqual(['Official Trailer', 'Trailer']);
    expect(titlesIn(rowOf('behind_the_scenes'))).toEqual(['Behind the Scenes']);
    const runtimes = Array.from(section.querySelectorAll('[data-testid="extra-runtime"]')).map(
      (el) => el.textContent,
    );
    expect(runtimes).toEqual(['2:05', '', '1:02:03']);
    // The first extra shows its own still.
    expect(section.querySelector(`img[src="${BASE_URL}/img/x1.webp"]`)).not.toBeNull();
    // The YouTube video is in its own row, not in this section.
    expect(within(section).queryByText('The Teaser')).toBeNull();
  });

  it('renders two kinds with the same number of extras without a duplicate key', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      serveDetail(server, {
        item: () =>
          itemDetail({
            extras: [
              { content_id: 'k1', kind: 'trailer' },
              { content_id: 'k2', kind: 'featurette' },
            ],
          }),
      });
      setup({ itemId: 'm1' });
      const section = await ready();
      expect(section.querySelectorAll('.row-section')).toHaveLength(2);
      expect(error.mock.calls.map((call) => String(call[0])).join(' ')).not.toMatch(/key/i);
    } finally {
      error.mockRestore();
    }
  });

  it('words the group headings in German', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          extras: [
            { content_id: 'l1', kind: 'deleted_scene' },
            { content_id: 'l2', kind: 'bloopers' },
            { content_id: 'l3', kind: 'making_of' },
          ],
        }),
    });
    setup({ itemId: 'm1' }, 'de');
    const section = await ready();
    expect(within(section).getByRole('heading', { name: 'Extras' })).toBeInTheDocument();
    expect(Array.from(section.querySelectorAll('.row-title')).map((el) => el.textContent)).toEqual([
      'Entfallene Szenen',
      'Outtakes',
      'Sonstige',
    ]);
    // A card without a title carries the singular kind label.
    expect(titlesIn(rowOf('deleted_scene'))).toEqual(['Entfallene Szene']);
    expect(titlesIn(rowOf('other'))).toEqual(['Extra']);
  });

  it('OK on a local extra plays it from its start, under its own content id and caption', async () => {
    serveDetail(server, { item: () => itemDetail({ extras }) });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('card:extras-trailer:local-1');
    await pressKey(KEY.enter);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'local-1',
      title: 'Official Trailer',
      intent: { kind: 'beginning' },
    });
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('local-1');
  });

  it('plays an extra of a later kind under its caption, the kind label for one without a title', async () => {
    serveDetail(server, { item: () => itemDetail({ extras }) });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs('card:extras-behind_the_scenes:local-2');
    await pressKey(KEY.enter);
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'local-2',
      title: 'Behind the Scenes',
      intent: { kind: 'beginning' },
    });
  });

  it('comes back from the player onto the same extra card', async () => {
    serveDetail(server, { item: () => itemDetail({ extras: allExtras }) });
    setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('card:extras-trailer:local-3');
    await pressKey(KEY.enter);
    await screen.findByTestId('player-stub');
    await pressKey(KEY.back);
    await ready();
    await focusKeyIs('card:extras-trailer:local-3');
  });
});

describe('DetailScreen: Trailers & More', () => {
  it('shows the YouTube videos only, in the server order, with title, kind and an Official badge', async () => {
    serveDetail(server, { item: () => itemDetail({ extras: [], videos }) });
    setup({ itemId: 'm1' });
    const row = await trailers();
    expect(within(row).getByRole('heading', { name: 'Trailers & More' })).toBeInTheDocument();
    // A title, else the kind's label; the Vimeo video is not offered.
    expect(titlesIn(row)).toEqual(['The Teaser', 'Clip']);
    // The kind under the title, none where the title is the kind's own label.
    const kinds = Array.from(row.querySelectorAll('.card-sub')).map((el) => ({
      kind: el.querySelector('[data-testid="extra-kind"]')?.textContent ?? null,
      official: el.querySelector('[data-testid="extra-official"]')?.textContent ?? null,
    }));
    expect(kinds).toEqual([
      { kind: 'Teaser', official: 'Official' },
      { kind: null, official: null },
    ]);
    // Nothing of this is in the Extras section, which these titles do not have.
    expect(screen.queryByTestId('detail-extras')).toBeNull();
  });

  it('words the row and the badge in German', async () => {
    serveDetail(server, { item: () => itemDetail({ extras: [], videos }) });
    setup({ itemId: 'm1' }, 'de');
    const row = await trailers();
    expect(within(row).getByRole('heading', { name: 'Trailer & mehr' })).toBeInTheDocument();
    expect(within(row).getByTestId('extra-official')).toHaveTextContent('Offiziell');
  });

  it('draws no YouTube pill on the picture: the whole row is YouTube', async () => {
    serveDetail(server, { item: () => itemDetail({ extras: [], videos }) });
    setup({ itemId: 'm1' });
    const row = await trailers();
    expect(row.querySelector('.card-pill')).toBeNull();
    expect(within(row).getByRole('button', { name: 'The Teaser, YouTube' })).toBeInTheDocument();
  });

  it('never loads a picture from YouTube or Google; a card shows the title backdrop', async () => {
    serveDetail(server, {
      item: () => itemDetail({ extras: [], videos, backdrop_url: '/img/backdrop.webp' }),
    });
    setup({ itemId: 'm1' });
    const row = await trailers();
    const sources = Array.from(document.querySelectorAll('[src], [href], [srcset]')).map(
      (el) => `${el.getAttribute('src')} ${el.getAttribute('href')} ${el.getAttribute('srcset')}`,
    );
    expect(sources.join(' ')).not.toMatch(/youtube|youtu\.be|ytimg|google|gstatic|ggpht/i);
    expect(row.querySelector(`img[src="${BASE_URL}/img/backdrop.webp"]`)).not.toBeNull();
  });

  it('OK on a card hands the video id to the platform and shows no notice when it opens', async () => {
    const open = platformAnswering('opened');
    serveDetail(server, { item: () => itemDetail({ videos }) });
    const { onPlay } = setup({ itemId: 'm1' });
    await trailers();
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
    await trailers();
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

  it("OK by key on a card hands that card's video to the platform", async () => {
    const open = platformAnswering('opened');
    serveDetail(server, { item: () => itemDetail({ videos }) });
    setup({ itemId: 'm1' });
    await trailers();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('card:trailers:dQw4w9WgXcQ');
    await pressKey(KEY.right);
    await focusKeyIs('card:trailers:abcdefghijk');
    await pressKey(KEY.enter);
    await waitFor(() => expect(open).toHaveBeenCalledWith('abcdefghijk'));
  });
});

describe('DetailScreen: Extras and Trailers & More as zones of the page', () => {
  it('puts both after the cast and before the box set and similar titles (movie)', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          extras,
          videos,
          cast: [{ name: 'First Actor', character: 'Fay', order: 0 }],
        }),
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One' })],
    });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByRole('button', { name: /Similar One/ });
    expect(zones()).toEqual(['cast', 'extras', 'trailers', 'similar']);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:0-First Actor');
    await pressKey(KEY.down);
    await focusKeyIs('card:extras-trailer:local-1');
    await pressKey(KEY.down);
    await focusKeyIs('card:extras-behind_the_scenes:local-2');
    await pressKey(KEY.down);
    await focusKeyIs('card:trailers:dQw4w9WgXcQ');
    await pressKey(KEY.down);
    await focusKeyIs('card:similar:x1');
    // The blocks above the focus fade; the page is a zone of its own.
    expect(document.querySelector('[data-zone="trailers"]')).toHaveAttribute('data-faded', 'true');
    await pressKey(KEY.up);
    await focusKeyIs('card:trailers:dQw4w9WgXcQ');
    expect(document.querySelector('[data-zone="extras"]')).toHaveAttribute('data-faded', 'true');
    expect(document.querySelector('[data-zone="trailers"]')).toHaveAttribute('data-faded', 'false');
  });

  it('puts both after the episodes of a series', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          play_content_id: 'e11',
          play_season_number: 1,
          extras,
          videos,
        }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1), episodeOf(1, 2)],
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One', type: 'series' })],
    });
    setup({ itemId: 's1' });
    await ready();
    await screen.findByTestId('episode-grid');
    await screen.findByRole('button', { name: /Similar One/ });
    expect(zones()).toEqual(['episodes', 'extras', 'trailers', 'similar']);
  });
});
