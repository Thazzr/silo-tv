import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider, type Language } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import { boxSetDetail } from '../../test/boxSetFixtures';
import { episodeOf, itemDetail, seasonOf, serveDetail } from '../../test/detailFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { pressPlayKey } from '../../test/playKey';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import type { PersonTarget } from '../person/personMemory';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';
import type { ItemDetail } from './info';
import { CardPrefsProvider } from '../../ui/media';

// The people and the sections under the hero, in the web's order for each type of page.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

type Screen =
  | { name: 'detail'; target: DetailTarget }
  | { name: 'player'; request: PlayRequest }
  | { name: 'person'; target: PersonTarget };

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
  const played = vi.fn<(request: PlayRequest) => void>();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'person' ? (
      <div data-testid="person-stub">
        {current.target.personId}|{current.target.personName}
      </div>
    ) : current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          played(request);
          nav.push({ name: 'player', request });
        }}
        onOpenDetail={(next) => nav.push({ name: 'detail', target: next })}
        onOpenPerson={(next) => nav.push({ name: 'person', target: next })}
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
          <CardPrefsProvider>
            <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
          </CardPrefsProvider>
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { played };
}

type Overrides = Partial<ItemDetail>;
const ready = () => screen.findByTestId('detail-hero');
const zones = () =>
  Array.from(document.querySelectorAll('[data-zone]')).map((el) => el.getAttribute('data-zone'));
const cardTitles = (row: HTMLElement) =>
  within(row)
    .getAllByTestId('card-title')
    .map((el) => el.textContent);

const crew = (name: string, job: string, id?: string): ItemDetail['crew'][number] => ({
  name,
  job,
  ...(id ? { person_id: id } : {}),
});

const movie = (overrides: Overrides = {}) =>
  itemDetail({
    content_id: 'm1',
    crew: [
      crew('Dana Director', 'Director', 'd1'),
      crew('Wen Writer', 'Writer', 'w1'),
      crew('Pia Producer', 'Producer', 'pr1'),
    ],
    cast: [
      { name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' },
      { name: 'Bo Actor', character: 'Bea', order: 1, person_id: 'p2' },
    ],
    ...overrides,
  });

describe('DetailScreen: the Cast & Crew strip of a movie', () => {
  it('shows directors, writers and cast with their roles and a divider before the later groups', async () => {
    serveDetail(server, { item: () => movie() });
    setup({ itemId: 'm1' });
    await ready();
    const row = await screen.findByTestId('row-cast');
    expect(within(row).getByRole('heading', { name: 'Cast & Crew' })).toBeInTheDocument();
    expect(cardTitles(row)).toEqual(['Dana Director', 'Wen Writer', 'Ann Actor', 'Bo Actor']);
    expect(
      within(row)
        .getAllByTestId('card-sub')
        .map((el) => el.textContent),
    ).toEqual(['Director', 'Writer', 'Ada', 'Bea']);
    // Producers are no part of the strip.
    expect(within(row).queryByText('Pia Producer')).toBeNull();
    const dividers = within(row).getAllByTestId('credit-divider');
    expect(dividers.map((el) => el.textContent)).toEqual(['Writers', 'Cast']);
    // A divider is no target: it is hidden from the accessibility tree and holds nothing focusable.
    for (const divider of dividers) {
      expect(divider).toHaveAttribute('aria-hidden', 'true');
      expect(divider.querySelector('button, [data-focus-key]')).toBeNull();
    }
    // Each divider sits in the slot of the first card of its group.
    expect(dividers[0]!.parentElement).toContainElement(
      within(row).getByRole('button', { name: 'Wen Writer, Writer' }),
    );
    expect(dividers[1]!.parentElement).toContainElement(
      within(row).getByRole('button', { name: 'Ann Actor, Ada' }),
    );
  });

  it('words the strip in German', async () => {
    serveDetail(server, { item: () => movie() });
    setup({ itemId: 'm1' }, 'de');
    const row = await screen.findByTestId('row-cast');
    expect(within(row).getByRole('heading', { name: 'Besetzung & Crew' })).toBeInTheDocument();
    expect(
      within(row)
        .getAllByTestId('card-sub')
        .map((el) => el.textContent),
    ).toEqual(['Regie', 'Drehbuch', 'Ada', 'Bea']);
    expect(
      within(row)
        .getAllByTestId('credit-divider')
        .map((el) => el.textContent),
    ).toEqual(['Drehbuch', 'Besetzung']);
  });

  it('walks across the dividers with Right, and OK on a writer opens the person page', async () => {
    serveDetail(server, { item: () => movie() });
    setup({ itemId: 'm1' });
    await screen.findByTestId('row-cast');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:lead:d1');
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:writer:w1');
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.left);
    await focusKeyIs('card:cast:writer:w1');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('person-stub')).toHaveTextContent('w1|Wen Writer');
  });

  it('comes back from the person page onto the card it left, across a divider', async () => {
    serveDetail(server, { item: () => movie() });
    setup({ itemId: 'm1' });
    await screen.findByTestId('row-cast');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:writer:w1');
    await pressKey(KEY.enter);
    await screen.findByTestId('person-stub');
    await pressKey(KEY.back);
    await screen.findByTestId('row-cast');
    await focusKeyIs('card:cast:writer:w1');
  });

  it('opens a director who also acts from either card, with a card of its own in each group', async () => {
    serveDetail(server, {
      item: () =>
        movie({
          crew: [crew('Both', 'Director', 'b')],
          cast: [{ name: 'Both', character: 'Himself', order: 0, person_id: 'b' }],
        }),
    });
    setup({ itemId: 'm1' });
    const row = await screen.findByTestId('row-cast');
    expect(cardTitles(row)).toEqual(['Both', 'Both']);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:lead:b');
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:cast:b');
  });

  it('does nothing on OK for a credit without a person id', async () => {
    serveDetail(server, {
      item: () => movie({ crew: [crew('Nobody Known', 'Director')], cast: [] }),
    });
    setup({ itemId: 'm1' });
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Nobody Known, Director' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('person-stub')).toBeNull();
  });

  it('puts the initials on a card without a photo and the picture on one with it', async () => {
    serveDetail(server, {
      item: () =>
        movie({
          crew: [
            { name: 'Dana Director', job: 'Director', person_id: 'd1', photo_url: '/img/d1.webp' },
            crew('Eve Editor', 'Director', 'd2'),
          ],
          cast: [],
        }),
    });
    setup({ itemId: 'm1' });
    const row = await screen.findByTestId('row-cast');
    expect(within(row).getByText('EE')).toHaveAttribute('data-testid', 'art-tile');
    expect(row.querySelector(`img[src="${BASE_URL}/img/d1.webp"]`)).not.toBeNull();
    expect(within(row).queryByText('DD')).toBeNull();
  });

  it('has no strip, and no heading, for a movie without crew and cast', async () => {
    serveDetail(server, { item: () => movie({ crew: [], cast: [] }) });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByTestId('row-cast')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cast & Crew' })).toBeNull();
    expect(zones()).toEqual([]);
  });

  it('shows no more than twelve cast members', async () => {
    const cast = Array.from({ length: 15 }, (_, i) => ({
      name: `Actor ${i}`,
      character: `Role ${i}`,
      order: i,
      person_id: `a${i}`,
    }));
    serveDetail(server, { item: () => movie({ crew: [], cast }) });
    setup({ itemId: 'm1' });
    const row = await screen.findByTestId('row-cast');
    expect(cardTitles(row)).toHaveLength(12);
  });
});

describe('DetailScreen: the Cast & Crew strip of a series', () => {
  const series = (overrides: Overrides = {}) =>
    itemDetail({
      content_id: 's1',
      type: 'series',
      title: 'A Show',
      versions: [],
      ...overrides,
    });

  it('leads with the creators, subtitled Creator, and then the cast', async () => {
    serveDetail(server, {
      item: () =>
        series({
          crew: [crew('Cree Ator', 'Creator', 'c1'), crew('Dana Director', 'Director', 'd1')],
          cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
        }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    const row = await screen.findByTestId('row-cast');
    expect(cardTitles(row)).toEqual(['Cree Ator', 'Ann Actor']);
    expect(
      within(row)
        .getAllByTestId('card-sub')
        .map((el) => el.textContent),
    ).toEqual(['Creator', 'Ada']);
    expect(
      within(row)
        .getAllByTestId('credit-divider')
        .map((el) => el.textContent),
    ).toEqual(['Cast']);
  });

  it('falls back to the directors for a series without a creator', async () => {
    serveDetail(server, {
      item: () => series({ crew: [crew('Dana Director', 'Director', 'd1')], cast: [] }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    const row = await screen.findByTestId('row-cast');
    expect(cardTitles(row)).toEqual(['Dana Director']);
    expect(within(row).getByTestId('card-sub')).toHaveTextContent('Director');
  });
});

describe('DetailScreen: the cast row of a season and an episode', () => {
  const people = Array.from({ length: 24 }, (_, i) => ({
    name: `Actor ${i}`,
    character: `Role ${i}`,
    order: i,
    person_id: `a${i}`,
  })).reverse();
  const season = (overrides: Overrides = {}) =>
    itemDetail({
      content_id: 'season-1',
      type: 'season',
      title: 'Season 1',
      series_id: 's1',
      series_title: 'A Show',
      season_number: 1,
      versions: [],
      ...overrides,
    });
  const episode = (overrides: Overrides = {}) =>
    itemDetail({
      content_id: 'e1',
      type: 'episode',
      title: 'An Episode',
      series_id: 's1',
      series_title: 'A Show',
      season_number: 1,
      episode_number: 1,
      ...overrides,
    });

  it('shows the first twenty by billing order, with no crew cards and no divider', async () => {
    serveDetail(server, {
      item: () => season({ cast: people, crew: [crew('Dana Director', 'Director', 'd1')] }),
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 'season-1' });
    const row = await screen.findByTestId('row-cast');
    await screen.findByTestId('episode-grid');
    expect(within(row).getByRole('heading', { name: 'Cast' })).toBeInTheDocument();
    // The row mounts only the cards near the screen: walk it to its end.
    expect(cardTitles(row)[0]).toBe('Actor 0');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:a0');
    for (let i = 1; i < 20; i += 1) await pressKey(KEY.right);
    await focusKeyIs('card:cast:cast:a19');
    // No twenty-first card: the last one stays.
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:cast:a19');
    expect(within(row).queryByText('Actor 20')).toBeNull();
    expect(within(row).queryByText('Dana Director')).toBeNull();
    expect(within(row).queryByTestId('credit-divider')).toBeNull();
  });

  it('shows the same row on an episode page, and nothing without cast', async () => {
    serveDetail(server, {
      item: (id) =>
        id === 'e1'
          ? episode({ cast: people.slice(0, 3) })
          : itemDetail({ content_id: id, type: 'series', title: 'A Show', versions: [] }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1, { content_id: 'e1' })],
    });
    setup({ itemId: 'e1' });
    const row = await screen.findByTestId('row-cast');
    // The cast comes in reverse billing order from the server; the row sorts it.
    expect(cardTitles(row)).toEqual(['Actor 21', 'Actor 22', 'Actor 23']);
  });

  it('has no cast row for a season without cast', async () => {
    serveDetail(server, { item: () => season(), episodes: () => [episodeOf(1, 1)] });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('episode-grid');
    expect(screen.queryByTestId('row-cast')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cast' })).toBeNull();
  });
});

describe('DetailScreen: the Crew row of a season and an episode', () => {
  const episode = (overrides: Overrides = {}) =>
    itemDetail({
      content_id: 'e1',
      type: 'episode',
      title: 'An Episode',
      series_id: 's1',
      series_title: 'A Show',
      season_number: 1,
      episode_number: 1,
      ...overrides,
    });
  const season = (overrides: Overrides = {}) =>
    itemDetail({
      content_id: 'season-1',
      type: 'season',
      title: 'Season 1',
      series_id: 's1',
      series_title: 'A Show',
      season_number: 1,
      versions: [],
      ...overrides,
    });
  const serveEpisode = (overrides: Overrides) =>
    serveDetail(server, {
      item: (id) =>
        id === 'e1'
          ? episode(overrides)
          : itemDetail({ content_id: id, type: 'series', title: 'A Show', versions: [] }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1, { content_id: 'e1' })],
    });
  const serveSeason = (overrides: Overrides) =>
    serveDetail(server, { item: () => season(overrides), episodes: () => [episodeOf(1, 1)] });
  const withCast = [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }];
  const credits = [
    crew('Pia Producer', 'Producer', 'pr1'),
    crew('Wen Writer', 'Writer', 'w1'),
    crew('Dana Director', 'Director', 'd1'),
    crew('Dana Director', 'Director', 'd1'),
    crew('Dee Director', 'Director', 'd2'),
  ];
  const subs = (row: HTMLElement) =>
    within(row)
      .getAllByTestId('card-sub')
      .map((el) => el.textContent);
  const dividers = (row: HTMLElement) =>
    within(row)
      .queryAllByTestId('credit-divider')
      .map((el) => el.textContent);
  /** Down from the buttons to the cast row (a lone episode has no episode row). */
  const toCast = async () => {
    await screen.findByTestId('row-crew');
    await screen.findByTestId('episode-grid').catch(() => undefined);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
  };

  it('shows the Crew row of an episode under Besetzung: cards, one per person, with dividers', async () => {
    serveEpisode({ cast: withCast, crew: credits });
    setup({ itemId: 'e1' });
    const row = await screen.findByTestId('row-crew');
    expect(within(row).getByRole('heading', { name: 'Crew' })).toBeInTheDocument();
    expect(cardTitles(row)).toEqual([
      'Dana Director',
      'Dee Director',
      'Wen Writer',
      'Pia Producer',
    ]);
    expect(subs(row)).toEqual(['Director', 'Director', 'Writer', 'Producer']);
    expect(dividers(row)).toEqual(['Writers', 'Producers']);
    expect(screen.queryByTestId('crew-box')).toBeNull();
    expect(zones()).toEqual(['cast', 'crew']);
  });

  it('shows the same row on a season page, after the episodes and the cast', async () => {
    serveSeason({ cast: withCast, crew: credits });
    setup({ itemId: 'season-1' });
    const row = await screen.findByTestId('row-crew');
    expect(cardTitles(row)).toEqual([
      'Dana Director',
      'Dee Director',
      'Wen Writer',
      'Pia Producer',
    ]);
    expect(zones()).toEqual(['episodes', 'cast', 'crew']);
  });

  it('words the heading, subtitles and dividers in German', async () => {
    serveEpisode({ crew: credits });
    setup({ itemId: 'e1' }, 'de');
    const row = await screen.findByTestId('row-crew');
    expect(within(row).getByRole('heading', { name: 'Crew' })).toBeInTheDocument();
    expect(subs(row)).toEqual(['Regie', 'Regie', 'Drehbuch', 'Produktion']);
    expect(dividers(row)).toEqual(['Drehbuch', 'Produktion']);
  });

  it('lists a director who also wrote once, with both jobs, and leaves Screenplay out', async () => {
    serveEpisode({
      crew: [
        crew('Both', 'Director', 'b'),
        crew('Both', 'Writer', 'b'),
        crew('Sam Screen', 'Screenplay', 's1'),
      ],
    });
    setup({ itemId: 'e1' });
    const row = await screen.findByTestId('row-crew');
    expect(cardTitles(row)).toEqual(['Both']);
    expect(subs(row)).toEqual(['Director, Writer']);
  });

  it('has no crew row, and no heading, without a listed job', async () => {
    serveEpisode({ cast: withCast, crew: [crew('Dee Dop', 'Director of Photography', 'x')] });
    setup({ itemId: 'e1' });
    await screen.findByTestId('row-cast');
    expect(screen.queryByTestId('row-crew')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Crew' })).toBeNull();
  });

  it('has no crew row on a movie and a series: their strip is unchanged', async () => {
    serveDetail(server, { item: () => movie() });
    setup({ itemId: 'm1' });
    const strip = await screen.findByTestId('row-cast');
    expect(cardTitles(strip)).toEqual(['Dana Director', 'Wen Writer', 'Ann Actor', 'Bo Actor']);
    expect(screen.queryByTestId('row-crew')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Crew' })).toBeNull();
    expect(zones()).toEqual(['cast']);
  });

  it('has no crew row on a series page', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          versions: [],
          crew: [crew('Dana Director', 'Director', 'd1')],
        }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    await screen.findByTestId('row-cast');
    expect(screen.queryByTestId('row-crew')).toBeNull();
  });

  it('walks Down from Besetzung to the first crew card and Up back, and Right along the row', async () => {
    serveEpisode({ cast: withCast, crew: credits });
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await focusKeyIs('card:crew:crew:d1');
    await pressKey(KEY.right);
    await focusKeyIs('card:crew:crew:d2');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p1');
  });

  it('reaches the crew row with Down and leaves it with Up whatever the spatial search would pick', async () => {
    serveEpisode({ cast: withCast, crew: credits });
    setup({ itemId: 'e1' });
    await toCast();
    // The crew card lies far to the side in the fake layout: only the page's own block walk finds it.
    document.querySelector<HTMLElement>('[data-focus-key="card:crew:crew:d1"]')!.dataset.rect =
      '90000,2000,100,100';
    await pressKey(KEY.down);
    await focusKeyIs('card:crew:crew:d1');
    document.querySelector<HTMLElement>('[data-focus-key="card:cast:cast:p1"]')!.dataset.rect =
      '90000,0,100,100';
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p1');
  });

  it('comes back onto the crew card it left when entered again from above', async () => {
    serveEpisode({ cast: withCast, crew: credits });
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs('card:crew:crew:w1');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.down);
    await focusKeyIs('card:crew:crew:w1');
  });

  it('opens the person page on OK, and Back returns to the same crew card', async () => {
    serveEpisode({ cast: withCast, crew: credits });
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('card:crew:crew:d2');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('person-stub')).toHaveTextContent('d2|Dee Director');
    await pressKey(KEY.back);
    await screen.findByTestId('row-crew');
    await focusKeyIs('card:crew:crew:d2');
  });

  it('takes the focus on a card without a person id but opens nothing', async () => {
    serveEpisode({ cast: withCast, crew: [crew('Dan Nobody', 'Director')] });
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await focusKeyIs('card:crew:crew:Dan Nobody');
    await pressKey(KEY.enter);
    expect(screen.queryByTestId('person-stub')).toBeNull();
    await focusKeyIs('card:crew:crew:Dan Nobody');
  });

  it('keeps the cast row and the crew row apart: each remembers its own card', async () => {
    serveEpisode({
      cast: [...withCast, { name: 'Bo Actor', character: 'Bea', order: 1, person_id: 'p2' }],
      crew: credits,
    });
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:cast:p2');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('card:crew:crew:d2');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p2');
  });

  it('scrolls the page to the Crew row when a card takes the focus', async () => {
    // jsdom has no layout: the zones get tops by name.
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      const zone = this.getAttribute('data-zone');
      return zone === 'crew' ? 1500 : zone === null ? 0 : 900;
    });
    try {
      serveEpisode({ cast: withCast, crew: [crew('Dir One', 'Director', 'd1')] });
      setup({ itemId: 'e1' });
      await toCast();
      const page = () => document.querySelector<HTMLElement>('.detail-page')!;
      await waitFor(() => expect(page().style.transform).toBe('translateY(-846px)'));
      await pressKey(KEY.down);
      await focusKeyIs('card:crew:crew:d1');
      await waitFor(() => expect(page().style.transform).toBe('translateY(-1446px)'));
    } finally {
      top.mockRestore();
    }
  });
});

describe('DetailScreen: the order of the sections under the hero', () => {
  const extras = [
    { content_id: 'local-1', kind: 'trailer', title: 'A Trailer' },
    { content_id: 'local-2', kind: 'featurette', title: 'A Featurette' },
  ];
  const videos = [
    { site: 'youtube', site_key: 'dQw4w9WgXcQ', kind: 'teaser', is_official: true, name: 'Teaser' },
  ];
  const similar = [catalogItem({ content_id: 'x1', title: 'Similar One' })];

  it("puts a movie's cast and crew first, then extras, trailers, the box set and similar titles", async () => {
    serveDetail(server, {
      item: () => movie({ extras, videos }),
      capabilities: { box_sets: true },
      boxSet: boxSetDetail(),
      similar,
    });
    setup({ itemId: 'm1' });
    await screen.findByTestId('row-boxset');
    await screen.findByTestId('row-similar');
    expect(zones()).toEqual(['cast', 'extras', 'trailers', 'boxSet', 'similar']);
    // Down walks the sections in that order, Up walks back.
    const order = [
      'card:cast:lead:d1',
      'card:extras-trailer:local-1',
      'card:extras-featurette:local-2',
      'card:trailers:dQw4w9WgXcQ',
      'card:boxset:film-1',
      'card:similar:x1',
    ];
    await focusKeyIs('detail-play');
    // The pills row sits between the buttons and the first section.
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    for (const key of order) {
      await pressKey(KEY.down);
      await focusKeyIs(key);
    }
    for (const key of order.slice(0, -1).reverse()) {
      await pressKey(KEY.up);
      await focusKeyIs(key);
    }
    await pressKey(KEY.up);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.up);
    await focusKeyIs('detail-play');
  });

  it.each([
    ['box set film', 'card:boxset:film-2', 'film-2'],
    ['similar title', 'card:similar:x1', 'x1'],
  ])(
    'plays a %s from where it left off on the Play key, without opening its page',
    async (_name, focusKey, contentId) => {
      serveDetail(server, {
        item: () => movie({ extras, videos }),
        capabilities: { box_sets: true },
        boxSet: boxSetDetail(),
        similar,
      });
      const { played } = setup({ itemId: 'm1' });
      await screen.findByTestId('row-boxset');
      await screen.findByTestId('row-similar');
      await focusKeyIs('detail-play');
      await pressKey(KEY.down);
      await focusKeyIs('detail-pill-subtitles');
      // Down through the sections to the box set row; the similar row is one more.
      for (const key of [
        'card:cast:lead:d1',
        'card:extras-trailer:local-1',
        'card:extras-featurette:local-2',
        'card:trailers:dQw4w9WgXcQ',
        'card:boxset:film-1',
        ...(focusKey === 'card:similar:x1' ? ['card:similar:x1'] : []),
      ]) {
        await pressKey(KEY.down);
        await focusKeyIs(key);
      }
      if (focusKey === 'card:boxset:film-2') {
        await pressKey(KEY.right);
        await focusKeyIs(focusKey);
      }
      await pressPlayKey();
      expect(await screen.findByTestId('player-stub')).toHaveTextContent(contentId);
      expect(played).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ contentId, intent: { kind: 'resume' } }),
      );
    },
  );

  it("puts a series' seasons first, then extras, trailers, cast and crew, then similar titles", async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          versions: [],
          extras,
          videos,
          crew: [crew('Cree Ator', 'Creator', 'c1')],
          cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
        }),
      seasons: [seasonOf(1), seasonOf(2)],
      episodes: () => [episodeOf(1, 1)],
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One', type: 'series' })],
    });
    setup({ itemId: 's1' });
    await screen.findByTestId('row-similar');
    await screen.findByTestId('season-rail');
    expect(zones()).toEqual(['seasons', 'extras', 'trailers', 'cast', 'similar']);
    const order = [
      'card:extras-trailer:local-1',
      'card:extras-featurette:local-2',
      'card:trailers:dQw4w9WgXcQ',
      'card:cast:lead:c1',
      'card:similar:x1',
    ];
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^season:/));
    for (const key of order) {
      await pressKey(KEY.down);
      await focusKeyIs(key);
    }
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:lead:c1');
    await pressKey(KEY.up);
    await focusKeyIs('card:trailers:dQw4w9WgXcQ');
  });

  it("puts a season's episodes first, then its cast and its crew", async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 'season-1',
          type: 'season',
          title: 'Season 1',
          series_id: 's1',
          series_title: 'A Show',
          season_number: 1,
          versions: [],
          cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
          crew: [crew('Dana Director', 'Director', 'd1')],
        }),
      episodes: () => [episodeOf(1, 1, { content_id: 'e1' })],
    });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('row-crew');
    await screen.findByTestId('episode-grid');
    expect(zones()).toEqual(['episodes', 'cast', 'crew']);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e1');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.down);
    await focusKeyIs('card:crew:crew:d1');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.up);
    await focusKeyIs('gcard:episodes:season-1:e1');
  });

  it("puts an episode's More Episodes row first, then its cast and its crew", async () => {
    serveDetail(server, {
      item: (id) =>
        id === 'e1'
          ? itemDetail({
              content_id: 'e1',
              type: 'episode',
              title: 'An Episode',
              series_id: 's1',
              series_title: 'A Show',
              season_number: 1,
              episode_number: 1,
              cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
              crew: [crew('Dana Director', 'Director', 'd1')],
            })
          : itemDetail({ content_id: id, type: 'series', title: 'A Show', versions: [] }),
      seasons: [seasonOf(1)],
      episodes: () => [
        episodeOf(1, 1, { content_id: 'e1' }),
        episodeOf(1, 2, { content_id: 'e2' }),
      ],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('row-crew');
    await screen.findByTestId('detail-more-episodes');
    expect(zones()).toEqual(['episodes', 'cast', 'crew']);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:more-episodes:e1');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.down);
    await focusKeyIs('card:crew:crew:d1');
  });

  it('fades the blocks above the focus by the order of the type: on a series the extras fade over the cast', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          versions: [],
          extras,
          cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
        }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    await screen.findByTestId('row-cast');
    const zone = (name: string) => document.querySelector(`[data-zone="${name}"]`)!;
    await focusKeyIs('detail-play');
    // The cast is below the extras on a series: the focus in it fades the extras, not the reverse.
    // Down: the episode grid, the two rows of extras, then the cast.
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    expect(zone('extras')).toHaveAttribute('data-faded', 'true');
    expect(zone('cast')).toHaveAttribute('data-faded', 'false');
  });
});

describe('DetailScreen: Up and Down walk the sections of the page, block by block', () => {
  it('goes from the last row of a long episode grid to Besetzung, and back up to the card it left', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 'season-1',
          type: 'season',
          title: 'Season 1',
          series_id: 's1',
          series_title: 'A Show',
          season_number: 1,
          versions: [],
          cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
          crew: [crew('Dana Director', 'Director', 'd1')],
        }),
      episodes: () =>
        Array.from({ length: 12 }, (_, i) => episodeOf(1, i + 1, { content_id: `e${i + 1}` })),
    });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('row-crew');
    await screen.findByTestId('episode-grid');
    await focusKeyIs('detail-play');
    // Five columns: rows of e1, e6 and e11.
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e1');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e6');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e11');
    // The next block is Besetzung, not the Crew row.
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    // Up lands on the grid card it was left from, not on the buttons above.
    await pressKey(KEY.up);
    await focusKeyIs('gcard:episodes:season-1:e11');
  });
});
