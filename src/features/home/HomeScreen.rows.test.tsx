import { act, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey } from '../../app/nav';
import { account } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { homeSection, resumeEpisode, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey, FocusIndexMemory, type CatalogItem } from '../../ui/media';
import { HERO_REST_MS } from './Hero';
import { HomeScreen } from './HomeScreen';

// What the rows below the hero look like: the card kind by section type, the captions, the
// de-duplication across rows, and the hero's card content for each kind of card.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

function setup() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return renderWithSilo(
    <HomeScreen
      rowMemory={new FocusIndexMemory()}
      onPlay={vi.fn<(item: CatalogItem) => void>()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
    />,
    { session },
  );
}

const resumed = resumeEpisode('e1', {
  title: 'Chapter Seven',
  series_title: 'Verity',
  season_number: 4,
  episode_number: 7,
});
const upNext = resumeEpisode('e2', {
  item_source: 'next_up',
  position_seconds: undefined,
  title: 'The Pilot',
  series_title: 'Dark',
  season_number: 1,
  episode_number: 1,
});
const film = catalogItem({
  content_id: 'm1',
  title: 'Heat',
  year: 1995,
  runtime: 170,
  content_rating: 'R',
  overview: 'A group of bank robbers.',
});
const show = catalogItem({
  content_id: 's1',
  title: 'Dark',
  type: 'series',
  year: 1997,
  overview: 'A missing child.',
});
const stray = catalogItem({
  content_id: 'ep9',
  type: 'episode',
  title: 'Lost Ep',
  series_title: 'Lost',
  season_number: 2,
  episode_number: 5,
  runtime: 45,
  item_source: undefined,
});

const sections = () => [
  homeSection('cw', 1, { section_type: 'continue_watching', items: [resumed], title: 'Continue' }),
  homeSection('nu', 1, { section_type: 'next_up', items: [upNext], title: 'Next' }),
  homeSection('rec', 3, { items: [film, show, stray], title: 'Recent' }),
];

const card = (row: string, id: string) =>
  document.querySelector<HTMLElement>(`[data-focus-key="${cardFocusKey(row, id)}"]`)!;

describe('HomeScreen: card kinds', () => {
  it('shows wide cards in Continue Watching and Next Up, and posters in every other row', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await screen.findByTestId('row-cw');
    expect(card('cw', 'e1')).toHaveClass('card-landscape');
    expect(card('nu', 'e2')).toHaveClass('card-landscape');
    expect(card('rec', 'm1')).toHaveClass('card-poster');
  });

  it('decides by the section type, not by a word in it', async () => {
    serveHome(server, {
      sections: [
        homeSection('a', 1, { section_type: 'system-next-up', items: [film], title: 'Next up' }),
      ],
    });
    setup();
    await screen.findByTestId('row-a');
    expect(card('a', 'm1')).toHaveClass('card-poster');
  });
});

describe('HomeScreen: captions', () => {
  it('gives a wide card the series, "Season 4 Episode 7 • Title" and the time left', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await screen.findByTestId('row-cw');
    const cw = within(card('cw', 'e1'));
    expect(cw.getByTestId('card-title')).toHaveTextContent('Verity');
    expect(cw.getByTestId('card-episode')).toHaveTextContent('Season 4 Episode 7 • Chapter Seven');
    expect(cw.getByTestId('card-status')).toHaveTextContent('30 min left');
  });

  it('gives a Next Up card "Next Episode" as its third line', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await screen.findByTestId('row-nu');
    const next = within(card('nu', 'e2'));
    expect(next.getByTestId('card-title')).toHaveTextContent('Dark');
    expect(next.getByTestId('card-episode')).toHaveTextContent('Season 1 Episode 1 • The Pilot');
    expect(next.getByTestId('card-status')).toHaveTextContent('Next Episode');
  });

  it('gives a poster card its title and the year, and a series "Series" after it', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await screen.findByTestId('row-rec');
    expect(within(card('rec', 'm1')).getByTestId('card-title')).toHaveTextContent('Heat');
    expect(within(card('rec', 'm1')).getByTestId('card-sub')).toHaveTextContent(/^1995$/);
    expect(within(card('rec', 's1')).getByTestId('card-sub')).toHaveTextContent(/^1997 Series$/);
  });
});

describe('HomeScreen: every card the server sends', () => {
  it('shows a card in every row that has it, as the web does for rows that keep duplicates', async () => {
    const one = catalogItem({ content_id: 'one', title: 'One' });
    serveHome(server, {
      sections: [
        homeSection('top', 1, { items: [one], title: 'Top' }),
        homeSection('low', 1, { items: [one], title: 'Low' }),
      ],
    });
    setup();
    await screen.findByTestId('row-low');
    expect(card('top', 'one')).not.toBeNull();
    expect(card('low', 'one')).not.toBeNull();
  });

  it('walks a row of 20 cards past the 8 that fit and ends on Alle entdecken', async () => {
    serveHome(server, { sections: [homeSection('long', 20, { total_count: 30 })] });
    setup();
    await focusKeyIs(cardFocusKey('long', 'long-1'));
    for (let i = 0; i < 8; i += 1) await pressKey(KEY.right);
    await focusKeyIs(cardFocusKey('long', 'long-9'));
    for (let i = 0; i < 12; i += 1) await pressKey(KEY.right);
    await focusKeyIs(cardFocusKey('long', 'explore'));
  });
});

describe('HomeScreen: the hero over a card', () => {
  it('shows the episode line and the time left over a Continue Watching card', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await focusKeyIs(cardFocusKey('cw', 'e1'));
    expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'e1');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Verity');
    expect(screen.getByTestId('hero-episode')).toHaveTextContent(
      'Season 4 Episode 7 • Chapter Seven',
    );
    expect(screen.getByTestId('hero-status')).toHaveTextContent('30 min left');
  });

  it('shows "Next Episode" over a Next Up card', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await focusKeyIs(cardFocusKey('cw', 'e1'));
    await pressKey(KEY.down);
    await sleep(HERO_REST_MS + 100);
    expect(screen.getByTestId('hero')).toHaveAttribute('data-content-id', 'e2');
    expect(screen.getByTestId('hero-status')).toHaveTextContent('Next Episode');
  });

  it('shows the movie, the series and an episode of a poster row without the wide card lines', async () => {
    serveHome(server, { sections: sections() });
    setup();
    await focusKeyIs(cardFocusKey('cw', 'e1'));
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs(cardFocusKey('rec', 'm1'));
    await sleep(HERO_REST_MS + 100);
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Heat');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('1995 · 2h 50m · R');
    expect(screen.getByTestId('hero-synopsis')).toHaveTextContent('A group of bank robbers.');
    expect(screen.queryByTestId('hero-episode')).toBeNull();
    expect(screen.queryByTestId('hero-status')).toBeNull();

    await pressKey(KEY.right);
    await sleep(HERO_REST_MS + 100);
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Dark');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('1997');

    await pressKey(KEY.right);
    await sleep(HERO_REST_MS + 100);
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Lost');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('S2 · E5 · 45 min');
    expect(screen.queryByTestId('hero-episode')).toBeNull();
    expect(screen.queryByTestId('hero-status')).toBeNull();
  });
});
