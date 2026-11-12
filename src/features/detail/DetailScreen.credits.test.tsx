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
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import type { PersonTarget } from '../person/personMemory';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';
import type { ItemDetail } from './info';

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
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'person' ? (
      <div data-testid="person-stub">
        {current.target.personId}|{current.target.personName}
      </div>
    ) : current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => nav.push({ name: 'player', request })}
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
          <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
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

describe('DetailScreen: the Crew box of a season and an episode', () => {
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
  const serveEpisode = (overrides: Overrides) =>
    serveDetail(server, {
      item: (id) =>
        id === 'e1'
          ? episode(overrides)
          : itemDetail({ content_id: id, type: 'series', title: 'A Show', versions: [] }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1, { content_id: 'e1' })],
    });
  const names = (row: string) =>
    within(screen.getByTestId(`crew-row-${row}`))
      .getAllByTestId(/crew-name/)
      .map((el) => el.textContent);
  const withCast = [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }];

  it('has a row for Director, Writer and Producer, in that order, each name once', async () => {
    serveEpisode({
      cast: withCast,
      crew: [
        crew('Pia Producer', 'Producer', 'pr1'),
        crew('Wen Writer', 'Writer', 'w1'),
        crew('Dana Director', 'Director', 'd1'),
        crew('Dana Director', 'Director', 'd1'),
        crew('Dee Director', 'Director', 'd2'),
      ],
    });
    setup({ itemId: 'e1' });
    const box = await screen.findByTestId('crew-box');
    expect(screen.getByRole('heading', { name: 'Crew' })).toBeInTheDocument();
    const rows = Array.from(box.querySelectorAll('[data-testid^="crew-row-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(rows).toEqual(['crew-row-director', 'crew-row-writer', 'crew-row-producer']);
    expect(Array.from(box.querySelectorAll('.crew-label')).map((el) => el.textContent)).toEqual([
      'Directors',
      'Writers',
      'Producers',
    ]);
    expect(names('director')).toEqual(['Dana Director', 'Dee Director']);
    expect(names('writer')).toEqual(['Wen Writer']);
    expect(names('producer')).toEqual(['Pia Producer']);
  });

  it('words the labels in German', async () => {
    serveEpisode({
      crew: [
        crew('Dana Director', 'Director', 'd1'),
        crew('Wen Writer', 'Writer', 'w1'),
        crew('Pia Producer', 'Producer', 'pr1'),
      ],
    });
    setup({ itemId: 'e1' }, 'de');
    const box = await screen.findByTestId('crew-box');
    expect(screen.getByRole('heading', { name: 'Crew' })).toBeInTheDocument();
    expect(Array.from(box.querySelectorAll('.crew-label')).map((el) => el.textContent)).toEqual([
      'Regie',
      'Drehbuch',
      'Produktion',
    ]);
  });

  it('leaves out a row without credits, and does not list a Screenplay credit as a writer', async () => {
    serveEpisode({
      crew: [crew('Sam Screen', 'Screenplay', 's1'), crew('Dana Director', 'Director', 'd1')],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('crew-box');
    expect(screen.getByTestId('crew-row-director')).toBeInTheDocument();
    expect(screen.queryByTestId('crew-row-writer')).toBeNull();
    expect(screen.queryByTestId('crew-row-producer')).toBeNull();
    // The hero's credit line counts Screenplay as writing; the box does not.
    expect(within(screen.getByTestId('crew-box')).queryByText('Sam Screen')).toBeNull();
  });

  it('has no box, and no heading, without a listed job', async () => {
    serveEpisode({ cast: withCast, crew: [crew('Dee Dop', 'Director of Photography', 'x')] });
    setup({ itemId: 'e1' });
    await screen.findByTestId('row-cast');
    expect(screen.queryByTestId('crew-box')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Crew' })).toBeNull();
  });

  it('walks a row with Left and Right and stops at its ends', async () => {
    serveEpisode({
      cast: withCast,
      crew: [
        crew('Dana Director', 'Director', 'd1'),
        crew('Dee Director', 'Director', 'd2'),
        crew('Wen Writer', 'Writer', 'w1'),
      ],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('crew-box');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d1');
    await pressKey(KEY.left);
    await focusKeyIs('crew:director:d1');
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d2');
    // The end of the row does not jump to a name of another row.
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d2');
    await pressKey(KEY.left);
    await focusKeyIs('crew:director:d1');
  });

  it('moves between the rows with Down and Up, keeps the column and skips a row without a target', async () => {
    serveEpisode({
      cast: withCast,
      crew: [
        crew('Dana Director', 'Director', 'd1'),
        crew('Dee Director', 'Director', 'd2'),
        // Only names without a person: nothing in this row can take the focus.
        crew('Wen Writer', 'Writer'),
        crew('Pia Producer', 'Producer', 'pr1'),
        crew('Pat Producer', 'Producer', 'pr2'),
        crew('Pol Producer', 'Producer', 'pr3'),
      ],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('crew-box');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d1');
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d2');
    // Down skips the writers, lands on the same column of the producers.
    await pressKey(KEY.down);
    await focusKeyIs('crew:producer:pr2');
    await pressKey(KEY.right);
    await focusKeyIs('crew:producer:pr3');
    // Up lands on the last name of a shorter row.
    await pressKey(KEY.up);
    await focusKeyIs('crew:director:d2');
    // Up from the first row leaves the box for the cast row above.
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p1');
    // Down enters the box again, on the name it left.
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d2');
  });

  it('clamps the column on a shorter row', async () => {
    serveEpisode({
      cast: withCast,
      crew: [
        crew('Dana Director', 'Director', 'd1'),
        crew('Dee Director', 'Director', 'd2'),
        crew('Wen Writer', 'Writer', 'w1'),
      ],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('crew-box');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d2');
    await pressKey(KEY.down);
    await focusKeyIs('crew:writer:w1');
    // Past the last row nothing moves.
    await pressKey(KEY.down);
    await focusKeyIs('crew:writer:w1');
  });

  it('shows a name without a person id as plain text that cannot take the focus', async () => {
    serveEpisode({
      cast: withCast,
      crew: [crew('Dana Director', 'Director', 'd1'), crew('Dan Nobody', 'Director')],
    });
    setup({ itemId: 'e1' });
    const plain = await screen.findByText('Dan Nobody');
    expect(plain).toHaveAttribute('data-testid', 'crew-name-plain');
    expect(screen.queryByRole('button', { name: 'Dan Nobody' })).toBeNull();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d1');
  });

  it('opens the person page on OK, and Back returns to the same name', async () => {
    serveEpisode({
      cast: withCast,
      crew: [
        crew('Dana Director', 'Director', 'd1'),
        crew('Dee Director', 'Director', 'd2'),
        crew('Pia Producer', 'Producer', 'pr1'),
      ],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('crew-box');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d2');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('person-stub')).toHaveTextContent('d2|Dee Director');
    await pressKey(KEY.back);
    await screen.findByTestId('crew-box');
    await focusKeyIs('crew:director:d2');
  });

  it('scrolls a row that is wider than the box by a transform, so the focused name is in view', async () => {
    const left = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.textContent === 'Dee Director' ? 1500 : 0;
    });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    try {
      serveEpisode({
        cast: withCast,
        crew: [crew('Dana Director', 'Director', 'd1'), crew('Dee Director', 'Director', 'd2')],
      });
      setup({ itemId: 'e1' });
      await screen.findByTestId('crew-box');
      await focusKeyIs('detail-play');
      await pressKey(KEY.down);
      await focusKeyIs('detail-pill-subtitles');
      await pressKey(KEY.down);
      await pressKey(KEY.down);
      await focusKeyIs('crew:director:d1');
      const track = () => document.querySelector<HTMLElement>('.crew-track')!;
      expect(track().style.transform).toBe('translateX(0px)');
      await pressKey(KEY.right);
      await focusKeyIs('crew:director:d2');
      // 1500 + 400 = 1900 must end 24 px before the 1000 px edge: 1900 - 1000 + 24.
      await waitFor(() => expect(track().style.transform).toBe('translateX(-924px)'));
      await pressKey(KEY.left);
      await focusKeyIs('crew:director:d1');
      await waitFor(() => expect(track().style.transform).toBe('translateX(0px)'));
    } finally {
      left.mockRestore();
      width.mockRestore();
      client.mockRestore();
    }
  });

  it('shows the crew box of a season page after its cast', async () => {
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
          cast: withCast,
          crew: [crew('Dana Director', 'Director', 'd1')],
        }),
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('crew-box');
    expect(zones()).toEqual(['episodes', 'cast', 'crew']);
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
    await screen.findByTestId('crew-box');
    await screen.findByTestId('episode-grid');
    expect(zones()).toEqual(['episodes', 'cast', 'crew']);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e1');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d1');
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
    await screen.findByTestId('crew-box');
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
    await focusKeyIs('crew:director:d1');
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
    await screen.findByTestId('crew-box');
    await screen.findByTestId('episode-grid');
    await focusKeyIs('detail-play');
    // Five columns: rows of e1, e6 and e11.
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e1');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e6');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:season-1:e11');
    // The next block is Besetzung, not the Crew box.
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
    // Up lands on the grid card it was left from, not on the buttons above.
    await pressKey(KEY.up);
    await focusKeyIs('gcard:episodes:season-1:e11');
  });
});

describe('DetailScreen: the Crew box keys', () => {
  const episode = (overrides: Overrides) =>
    itemDetail({
      content_id: 'e1',
      type: 'episode',
      title: 'An Episode',
      series_id: 's1',
      series_title: 'A Show',
      season_number: 1,
      episode_number: 1,
      cast: [{ name: 'Ann Actor', character: 'Ada', order: 0, person_id: 'p1' }],
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
  const key = (focusKey: string) =>
    document.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)!;
  /** jsdom has no layout: put the named elements where the test wants the spatial search to see them. */
  const place = (rects: Record<string, string>) => {
    for (const [focusKey, rect] of Object.entries(rects)) key(focusKey).dataset.rect = rect;
  };
  /** Down from the buttons to the cast row (the page has no episode row for a lone episode). */
  const toCast = async () => {
    await screen.findByTestId('crew-box');
    await screen.findByTestId('episode-grid').catch(() => undefined);
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
  };
  const three = {
    crew: [
      crew('Dir One', 'Director', 'd1'),
      crew('Dir Two', 'Director', 'd2'),
      crew('Wri One', 'Writer', 'w1'),
      crew('Wri Two', 'Writer', 'w2'),
      crew('Pro One', 'Producer', 'p1'),
      crew('Pro Two', 'Producer', 'p2'),
    ],
  };

  it('holds Left and Right at the ends of a row, also where a name of another row lies beside it', async () => {
    serveEpisode({
      crew: [
        crew('Dir One', 'Director', 'd1'),
        crew('Wri One', 'Writer', 'w1'),
        crew('Wri Two', 'Writer', 'w2'),
        crew('Wri Three', 'Writer', 'w3'),
      ],
    });
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d1');
    // The writers' names stand to the right of the lone director in the fake layout.
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d1');
    await pressKey(KEY.left);
    await focusKeyIs('crew:director:d1');
  });

  it('walks Down through three rows and Up back, to the same column, whatever the spatial search would pick', async () => {
    serveEpisode(three);
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d1');
    // Rows are 1000 px apart; in every row the first name sits at the far side of the second.
    place({
      'crew:director:d1': '0,0,100,100',
      'crew:director:d2': '5000,0,100,100',
      'crew:writer:w1': '5000,1000,100,100',
      'crew:writer:w2': '0,1000,100,100',
      'crew:producer:p1': '0,2000,100,100',
      'crew:producer:p2': '5000,2000,100,100',
    });
    await pressKey(KEY.down);
    await focusKeyIs('crew:writer:w1');
    await pressKey(KEY.down);
    await focusKeyIs('crew:producer:p1');
    await pressKey(KEY.up);
    await focusKeyIs('crew:writer:w1');
    await pressKey(KEY.up);
    await focusKeyIs('crew:director:d1');
  });

  it('comes back onto the name it left when entered again from below', async () => {
    serveEpisode(three);
    setup({ itemId: 'e1' });
    await toCast();
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d1');
    await pressKey(KEY.right);
    await focusKeyIs('crew:director:d2');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:p1');
    await pressKey(KEY.down);
    await focusKeyIs('crew:director:d2');
  });

  it('takes no focus when no name has a person page: Down from the cast stays on the cast', async () => {
    serveEpisode({ crew: [crew('Nobody One', 'Director'), crew('Nobody Two', 'Writer')] });
    setup({ itemId: 'e1' });
    await toCast();
    // jsdom has no layout: put the box below the cast, where the search would find it.
    screen.getByTestId('crew-box').dataset.rect = '0,90000,100,100';
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p1');
  });

  it('enters on the first name that can take the focus, past a row of names without a page', async () => {
    serveEpisode({
      crew: [
        crew('Nobody One', 'Director'),
        crew('Wri One', 'Writer', 'w1'),
        crew('Wri Two', 'Writer', 'w2'),
      ],
    });
    setup({ itemId: 'e1' });
    await toCast();
    // The second writer is the one nearest the origin for the spatial search.
    place({ 'crew:writer:w1': '5000,1000,100,100', 'crew:writer:w2': '0,1000,100,100' });
    await pressKey(KEY.down);
    await focusKeyIs('crew:writer:w1');
  });

  it('puts a comma between names and none before the first', async () => {
    serveEpisode({
      crew: [
        crew('Dir One', 'Director', 'd1'),
        crew('Dir Two', 'Director', 'd2'),
        crew('Dir Three', 'Director', 'd3'),
      ],
    });
    setup({ itemId: 'e1' });
    await screen.findByTestId('crew-box');
    const track = screen.getByTestId('crew-row-director').querySelector('.crew-track')!;
    expect(track.querySelectorAll('.crew-sep')).toHaveLength(2);
    expect(track.firstElementChild).toHaveAttribute('data-testid', 'crew-name');
    expect(track.children).toHaveLength(5);
  });

  it('scrolls the page to the Crew box when a name takes the focus', async () => {
    // jsdom has no layout: the zones get tops by name.
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      const zone = this.getAttribute('data-zone');
      return zone === 'crew' ? 1500 : zone === null ? 0 : 900;
    });
    try {
      serveEpisode({ crew: [crew('Dir One', 'Director', 'd1')] });
      setup({ itemId: 'e1' });
      await toCast();
      const page = () => document.querySelector<HTMLElement>('.detail-page')!;
      await waitFor(() => expect(page().style.transform).toBe('translateY(-846px)'));
      await pressKey(KEY.down);
      await focusKeyIs('crew:director:d1');
      await waitFor(() => expect(page().style.transform).toBe('translateY(-1446px)'));
    } finally {
      top.mockRestore();
    }
  });
});
