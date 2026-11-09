import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import { KEY, pressKey } from '../../test/keys';
import { movies, personOf, servePerson, shows, type PersonServe } from '../../test/personFixtures';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { gridCardKey } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { PersonMemory, type PersonEntryMemory, type PersonTarget } from './personMemory';
import { PersonScreen } from './PersonScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const cardKey = (id: string, filter = 'all', person = 'p-1') =>
  gridCardKey(`person:${person}:${filter}`, id);

type Screen =
  | { name: 'person'; target: PersonTarget }
  | ({ name: 'detail' } & DetailTarget)
  | { name: 'player'; contentId: string };

/**
 * The person page on a screen stack with stub detail and player pages: OK on a title pushes the
 * stub of its detail page, and Back pops, like the flow does.
 */
function setup(
  target: PersonTarget = { personId: 'p-1' },
  options: { queryClient?: QueryClient; memory?: PersonEntryMemory; onBack?: () => void } = {},
) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memories = new PersonMemory();
  const onBack = options.onBack ?? vi.fn();
  const onPlay = vi.fn();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) => {
    if (current.name === 'detail') return <div data-testid="detail-stub">{current.itemId}</div>;
    if (current.name === 'player') return <div data-testid="player-stub">{current.contentId}</div>;
    return (
      <PersonScreen
        target={current.target}
        memory={options.memory ?? memories.of(current)}
        onPlay={(item) => {
          onPlay(item.content_id);
          nav.push({ name: 'player', contentId: item.content_id });
        }}
        onOpenDetail={(next) => nav.push({ name: 'detail', ...next })}
        onBack={() => {
          onBack();
          nav.pop();
        }}
      />
    );
  };
  const view = render(
    <QueryClientProvider client={options.queryClient ?? newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'person', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onBack, onPlay, ...view };
}

const serveMovies = (n = 3, extra: PersonServe = {}) =>
  servePerson(server, { titles: { video: movies(n), movie: movies(n) }, ...extra });
const ready = () => screen.findByTestId('person-header');
const pillNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

describe('PersonScreen: the header', () => {
  it('shows the name, the badges and the biography', async () => {
    serveMovies(2, {
      person: personOf({
        name: 'Ada Actor',
        birth_date: '1940-04-25',
        death_date: '2004-07-01',
        birthplace: 'Springfield, USA',
        bio: 'Ada was an actor.',
      }),
    });
    setup();
    await ready();
    expect(screen.getByTestId('person-name')).toHaveTextContent('Ada Actor');
    const facts = within(screen.getByTestId('person-facts'))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(facts).toEqual([
      'Born April 25, 1940',
      'Died July 1, 2004 (age 64)',
      'Springfield, USA',
    ]);
    expect(screen.getByTestId('person-bio')).toHaveTextContent('Ada was an actor.');
    // A short biography has no More button.
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('shows the age today for a living person, and no badges for an unknown one', async () => {
    serveMovies(1, { person: personOf({ death_date: undefined }) });
    const view = setup();
    await ready();
    const facts = within(screen.getByTestId('person-facts')).getAllByRole('listitem');
    expect(facts[1]!.textContent).toMatch(/^\d+ years old$/);
    view.unmount();

    serveMovies(1, {
      person: personOf({
        birth_date: undefined,
        death_date: undefined,
        birthplace: undefined,
        bio: undefined,
      }),
    });
    setup();
    await ready();
    expect(screen.queryByTestId('person-facts')).toBeNull();
    expect(screen.queryByTestId('person-bio')).toBeNull();
  });

  it('puts the initials on the portrait without a photo, and the photo when there is one', async () => {
    serveMovies(1, { person: personOf({ name: 'Ada Actor', photo_url: undefined }) });
    const view = setup();
    await ready();
    expect(within(screen.getByTestId('person-portrait')).getByTestId('art-tile')).toHaveTextContent(
      'AA',
    );
    view.unmount();

    serveMovies(1, { person: personOf({ photo_url: '/img/ada.webp' }) });
    setup();
    await ready();
    expect(screen.getByTestId('person-portrait').querySelector('img')).toHaveAttribute(
      'src',
      `${BASE_URL}/img/ada.webp`,
    );
  });

  it('paints the name from the route at once, before the person is read, on a skeleton', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    serveMovies(2, { holdPerson: held });
    setup({ personId: 'p-1', personName: 'Ada Actor' });
    expect(screen.getByTestId('person-name')).toHaveTextContent('Ada Actor');
    expect(screen.queryByTestId('person-bio')).toBeNull();
    // The grid has its own skeleton, so the page does not jump when the titles come.
    expect(screen.getByTestId('grid-skeleton')).toBeInTheDocument();
    release();
    await ready();
    expect(screen.queryByTestId('grid-skeleton')).toBeNull();
  });

  it('cuts a long biography and opens the full text from More; Back closes it onto More', async () => {
    const bio = 'Ada was an actor. '.repeat(60).trim();
    serveMovies(1, { person: personOf({ bio }) });
    const { onBack } = setup();
    await ready();
    await focusKeyIs('person-pill:all');
    await pressKey(KEY.up);
    await focusKeyIs('person-more');
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('synopsis-dialog');
    expect(within(dialog).getByTestId('synopsis-full')).toHaveTextContent(bio);
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('synopsis-dialog')).toBeNull());
    await focusKeyIs('person-more');
    // The page is still there: Back closed only the dialog.
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('person-header')).toBeInTheDocument();
  });

  it('reads the person plainly: no prefetch flag, and nothing but the person and its titles', async () => {
    const calls = serveMovies(2);
    setup();
    await ready();
    await screen.findByTestId('person-count');
    expect(calls.people).toHaveLength(1);
    expect(calls.people[0]!.id).toBe('p-1');
    expect([...calls.people[0]!.query.keys()]).toEqual([]);
    expect(new Set(calls.requests)).toEqual(
      new Set(['GET /api/v2/catalog/people/p-1', 'GET /api/v2/catalog']),
    );
  });
});

describe('PersonScreen: the filmography', () => {
  it('lists the titles newest first as the server sends them, with the count, All selected and focused', async () => {
    const calls = serveMovies(3);
    setup();
    await ready();
    await screen.findByRole('button', { name: /Movie 1/ });
    expect(screen.getAllByTestId('card-title').map((el) => el.textContent)).toEqual([
      'Movie 1',
      'Movie 2',
      'Movie 3',
    ]);
    expect(screen.getByTestId('person-count')).toHaveTextContent('3 titles');
    // The list read: video, newest first, a page of 40, posters at the grid's width.
    const list = calls.titles.find((q) => q.get('limit') === '40')!;
    expect(list.get('source')).toBe('person');
    expect(list.get('person_id')).toBe('p-1');
    expect(list.get('type')).toBe('video');
    expect(list.get('sort')).toBe('-year');
    expect(list.has('poster_width')).toBe(true);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    await focusKeyIs('person-pill:all');
  });

  it('counts one title in the singular and an inexact total with a plus', async () => {
    serveMovies(1);
    const view = setup();
    await screen.findByTestId('person-count');
    expect(screen.getByTestId('person-count')).toHaveTextContent('1 title');
    expect(screen.getByTestId('person-count')).not.toHaveTextContent('1 titles');
    view.unmount();

    serveMovies(45, { totalExact: false });
    setup();
    await waitFor(() => expect(screen.getByTestId('person-count')).toHaveTextContent('40+ titles'));
  });

  it('shows the pills of the kinds the person has, found by one-card reads', async () => {
    const calls = servePerson(server, {
      titles: { video: [...movies(2), ...shows(1)], movie: movies(2), series: [] },
    });
    setup();
    await ready();
    await screen.findByRole('tab', { name: 'Movies' });
    // No series: the Series pill never shows.
    expect(pillNames()).toEqual(['All', 'Movies']);
    const probes = calls.titles.filter((q) => q.get('limit') === '1');
    expect(probes.map((q) => q.get('type')).sort()).toEqual(['movie', 'series']);
    expect(probes.every((q) => q.get('source') === 'person' && q.get('person_id') === 'p-1')).toBe(
      true,
    );
  });

  it('shows Series when the person has some, and no pill when the probes fail', async () => {
    servePerson(server, {
      titles: { video: [...movies(1), ...shows(2)], movie: 'fail', series: shows(2) },
    });
    setup();
    await ready();
    await screen.findByRole('tab', { name: 'Series' });
    expect(pillNames()).toEqual(['All', 'Series']);
  });

  it('reads another kind only on OK, never while the arrows move over the pills', async () => {
    const calls = servePerson(server, {
      titles: {
        video: [...movies(2), ...shows(1)],
        movie: movies(2, 10),
        series: shows(1),
      },
    });
    setup();
    await ready();
    await screen.findByRole('tab', { name: 'Series' });
    await focusKeyIs('person-pill:all');
    const listReads = () => calls.titles.filter((q) => q.get('limit') === '40');
    expect(listReads().map((q) => q.get('type'))).toEqual(['video']);

    await pressKey(KEY.right);
    await focusKeyIs('person-pill:movie');
    await pressKey(KEY.right);
    await focusKeyIs('person-pill:series');
    await pressKey(KEY.left);
    await focusKeyIs('person-pill:movie');
    await sleep(300);
    // Arrows alone changed nothing: the same list, no new read, the selection stays on All.
    expect(listReads().map((q) => q.get('type'))).toEqual(['video']);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('button', { name: /Movie 10/ })).toBeNull();

    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Movie 10/ });
    expect(listReads().map((q) => q.get('type'))).toEqual(['video', 'movie']);
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('person-count')).toHaveTextContent('2 titles');
    // The focus stays on the pill that was pressed.
    await focusKeyIs('person-pill:movie');
  });

  it('starts a list at its first title again when its pill is chosen again', async () => {
    servePerson(server, {
      titles: { video: [...movies(2), ...shows(1)], movie: movies(3, 10), series: shows(1) },
    });
    setup();
    await ready();
    await screen.findByRole('tab', { name: 'Movies' });
    await focusKeyIs('person-pill:all');
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Movie 10/ });
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('mov-10', 'movie'));
    await pressKey(KEY.right);
    await focusKeyIs(cardKey('mov-11', 'movie'));
    // Away to All and back to Movies: the grid does not keep the old position.
    await pressKey(KEY.up);
    await focusKeyIs('person-pill:movie');
    await pressKey(KEY.left);
    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Show 1/ });
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Movie 10/ });
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('mov-10', 'movie'));
  });

  it('a click on a pill reads its kind, too', async () => {
    const calls = servePerson(server, {
      titles: { video: [...movies(1), ...shows(2)], movie: movies(1), series: shows(2) },
    });
    setup();
    await ready();
    fireEvent.click(await screen.findByRole('tab', { name: 'Series' }));
    await screen.findByRole('button', { name: /Show 1/ });
    expect(calls.titles.some((q) => q.get('limit') === '40' && q.get('type') === 'series')).toBe(
      true,
    );
  });

  it('falls back to All, and reads it, when the selected kind has no titles', async () => {
    const calls = servePerson(server, { titles: { video: movies(2), movie: [], series: [] } });
    const memories = new PersonMemory();
    const memory = memories.of({});
    memory.filter = 'movie';
    setup({ personId: 'p-1' }, { memory });
    await screen.findByRole('button', { name: /Movie 1/ });
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(pillNames()).toEqual(['All']);
    expect(calls.titles.some((q) => q.get('limit') === '40' && q.get('type') === 'video')).toBe(
      true,
    );
  });

  it('moves from the pills into the grid with Down and back with Up', async () => {
    serveMovies(8);
    setup();
    await ready();
    await screen.findByRole('button', { name: /Movie 1/ });
    await focusKeyIs('person-pill:all');
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('mov-1'));
    await pressKey(KEY.right);
    await focusKeyIs(cardKey('mov-2'));
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('mov-8'));
    await pressKey(KEY.up);
    await focusKeyIs(cardKey('mov-2'));
    await pressKey(KEY.left);
    await pressKey(KEY.up);
    await focusKeyIs('person-pill:all');
  });

  it('marks the page as scrolled by a transform, and moves it once the focus is in the grid', async () => {
    serveMovies(8);
    setup();
    await ready();
    await screen.findByRole('button', { name: /Movie 1/ });
    expect(screen.getByTestId('person')).toHaveAttribute('data-transform-scrolled', 'page');
    const page = () => screen.getByTestId('person').querySelector<HTMLElement>('.person-page')!;
    expect(page().style.transform).toBe('translateY(0px)');
    expect(screen.getByTestId('person-header')).toHaveAttribute('data-faded', 'false');
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('mov-1'));
    // The pills' top is measured (0 in jsdom), so the page stays at its origin here; the
    // header and the heading fade out as soon as the focus is below the pills.
    await waitFor(() =>
      expect(screen.getByTestId('person-header')).toHaveAttribute('data-faded', 'true'),
    );
    await pressKey(KEY.up);
    await waitFor(() =>
      expect(screen.getByTestId('person-header')).toHaveAttribute('data-faded', 'false'),
    );
  });

  it('asks for the next page while the focus nears the end, with the server cursor', async () => {
    const calls = serveMovies(50);
    setup();
    await ready();
    await screen.findByTestId('grid-track');
    await pressKey(KEY.down);
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await waitFor(() =>
      expect(calls.titles.some((q) => q.get('limit') === '40' && q.get('cursor') === '40')).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('card-title').map((el) => el.textContent)).toContain('Movie 41'),
    );
  });

  it('OK on a title opens its detail page, and Back returns to the same card and the same filter', async () => {
    servePerson(server, {
      titles: {
        video: [...movies(2), ...shows(1)],
        movie: movies(4, 10),
        series: shows(1),
      },
    });
    setup();
    await ready();
    await screen.findByRole('tab', { name: 'Movies' });
    await focusKeyIs('person-pill:all');
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Movie 10/ });
    await pressKey(KEY.down);
    await focusKeyIs(cardKey('mov-10', 'movie'));
    await pressKey(KEY.right);
    await focusKeyIs(cardKey('mov-11', 'movie'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-stub')).toHaveTextContent('mov-11');

    await pressKey(KEY.back);
    await screen.findByTestId('person-header');
    await focusKeyIs(cardKey('mov-11', 'movie'));
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Movie 11/ })).toBeInTheDocument();
  });

  it('opens the detail page of a series card, too', async () => {
    servePerson(server, { titles: { video: shows(1), series: shows(1) } });
    setup();
    await screen.findByRole('button', { name: /Show 1/ });
    fireEvent.click(screen.getByRole('button', { name: /Show 1/ }));
    expect(await screen.findByTestId('detail-stub')).toHaveTextContent('ser-1');
  });

  it('says there are no titles when the person has none, without pills', async () => {
    serveMovies(0);
    setup();
    await ready();
    const empty = await screen.findByTestId('person-titles-empty');
    expect(empty).toHaveTextContent('No titles found');
    expect(empty).toHaveTextContent('There are no movies or series linked to this person yet.');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('person-count')).toBeNull();
  });

  it('offers Try again when the titles cannot be loaded, reached with Down from the pills', async () => {
    servePerson(server, { titles: { video: 'fail', movie: 'fail' } });
    setup();
    await ready();
    const error = await screen.findByTestId('person-titles-error');
    expect(error).toHaveTextContent("Can't load this person's titles.");
    await focusKeyIs('person-pill:all');
    await pressKey(KEY.down);
    await focusKeyIs('person-titles-retry');
    // Try again reads the list again (the newest handlers answer first).
    const calls = servePerson(server, { titles: { video: movies(2), movie: movies(2) } });
    await pressKey(KEY.enter);
    await screen.findByRole('button', { name: /Movie 1/ });
    expect(calls.titles.some((q) => q.get('limit') === '40')).toBe(true);
    expect(screen.queryByTestId('person-titles-error')).toBeNull();
  });
});

describe('PersonScreen: a person that cannot be shown', () => {
  it('says the person is not found on a 404 and Back leaves the page', async () => {
    servePerson(server, { person: 'gone' });
    const { onBack } = setup();
    const message = await screen.findByTestId('person-gone');
    expect(message).toHaveTextContent('Person not found');
    await focusKeyIs('person-retry');
    fireEvent.click(within(message).getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says it can't load the person on another failure, and Try again reads it again", async () => {
    const calls = servePerson(server, { person: 'fail' });
    setup();
    const message = await screen.findByTestId('person-error');
    expect(message).toHaveTextContent("Can't load this person.");
    expect(calls.people.length).toBeGreaterThan(0);
    servePerson(server, { person: personOf({ name: 'Ada Actor' }), titles: { video: movies(1) } });
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await ready();
    expect(screen.getByTestId('person-name')).toHaveTextContent('Ada Actor');
  });
});
