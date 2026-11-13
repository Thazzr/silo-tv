// The player's bottom bar on the real PlayerScreen: the Lucide glyphs, the order of the transport
// row and of the menu buttons, the subtitles dot, the quality pill, and the episode buttons with
// their spacers and what a press does. Real timers throughout (MSW and the spatial layer need them).
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { existsSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { episodeOf, seasonOf } from '../../test/detailFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import { KEY, pressKey } from '../../test/keys';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackPlan,
  servePlayback,
  until,
  watchDetail,
  watchVersion,
  type PlaybackServerOptions,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../session/startSession';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
beforeEach(() => {
  window.localStorage.clear();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
});
afterEach(async () => {
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const AUDIO: S['WatchAudioTrack'][] = [
  { language: 'en', codec: 'aac', channels: 2, default: true },
  { language: 'de', codec: 'aac', channels: 2, default: false },
];
const SUBTITLE = {
  track_id: 'sub:0',
  combined_index: 0,
  source: 'embedded',
  forced: false,
  default: false,
  hearing_impaired: false,
  delivery: 'sidecar',
  language: 'en',
} as const;
const CHAPTERS: S['WatchChapter'][] = [
  { index: 0, title: 'Opening', start_seconds: 0, end_seconds: 100, source: 'embedded' },
];

/** A plan with a subtitle list, the subtitle playing or not, and a quality ladder. */
const plan = (subtitleOn: boolean) =>
  playbackPlan({
    available_qualities: [
      {
        label: '1080p',
        display_name: '1080p',
        height: 1080,
        bitrate_kbps: 8000,
        preserves_source: false,
      },
    ],
    selected_tracks: {
      audio: { id: 'file:file-1:audio:0', index: 0 },
      ...(subtitleOn ? { subtitle: { id: 'sub:0', index: 0 } } : {}),
    },
    subtitle: { mode: 'sidecar', inventory: [SUBTITLE] },
  });

/** The watch data of a title whose remembered subtitle is the plan's English track. */
const PLAYS_SUBTITLE = {
  effective_subtitle_mode: 'always',
  effective_subtitle_language: 'en',
  effective_subtitle_track_signature: {
    source: 'embedded',
    language: 'en',
    forced: false,
    hearing_impaired: false,
  },
} as const;

const episodeWatch = (season: number, episode: number, subtitle = false) =>
  watchDetail({
    ...(subtitle ? PLAYS_SUBTITLE : {}),
    content_id: `e${season}${episode}`,
    type: 'episode',
    series_id: 'ser1',
    series_title: 'A Show',
    season_number: season,
    episode_number: episode,
    title: `Episode ${season}.${episode}`,
    versions: [watchVersion({ audio_tracks: AUDIO, chapters: CHAPTERS })],
  });

interface Series {
  seasons?: S['Season'][] | 'fail';
  /** The episodes of each season number. */
  episodes?: Record<number, S['Episode'][]>;
  /** Answers wait for these: the season list, and the episode list of a season number. */
  gates?: { seasons?: Promise<void>; episodes?: Record<number, Promise<void>> };
}

/** A promise the test settles by hand. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Serves the series reads the neighbours are found from, and records what was asked. */
function serveSeries(series: Series = {}) {
  /** Every series read's path. */
  const paths: string[] = [];
  /** The season numbers whose episode list was read. */
  const asked: string[] = [];
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/series/*`, async ({ request }) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      const match = /\/seasons(?:\/(\d+)\/episodes)?$/.exec(path);
      if (!match) return new HttpResponse(null, { status: 404 });
      if (match[1] === undefined) {
        await series.gates?.seasons;
        if (series.seasons === 'fail') return new HttpResponse(null, { status: 500 });
        return HttpResponse.json({ items: series.seasons ?? [] });
      }
      const season = Number(match[1]);
      asked.push(match[1]);
      await series.gates?.episodes?.[season];
      return HttpResponse.json({ items: series.episodes?.[season] ?? [] });
    }),
  );
  return { asked, paths };
}

const playable = [{ file_id: 'f', hdr: false, file_size: 1 }];
const unplayable = [{ file_id: 'f', hdr: false, file_size: 1, unreadable: true }];
const ep = (season: number, n: number, files = playable) => episodeOf(season, n, { files });

async function mount(
  options: PlaybackServerOptions & {
    lang?: 'de' | 'en';
  } = {},
) {
  const { lang, ...playback } = options;
  const onEpisode = vi.fn();
  const calls = servePlayback(server, { start: [playableDecision(plan(false))], ...playback });
  serveSettings(server, {});
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const view = renderWithSilo(
    <PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} onEpisode={onEpisode} />,
    { session, lang },
  );
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  fireEvent.playing(video);
  await screen.findByLabelText(lang === 'de' ? '10 Sekunden zurück' : '10 seconds back');
  return { calls, view, video, state, onEpisode };
}

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const keysOf = (selector: string) =>
  [...document.querySelectorAll(`${selector} [data-focus-key]`)].map((e) =>
    e.getAttribute('data-focus-key'),
  );
const focused = () =>
  [...document.querySelectorAll('[data-focus-key]')]
    .filter((e) => e.getAttribute('data-focused') === 'true')
    .map((e) => e.getAttribute('data-focus-key'));
const button = (name: string) => document.querySelector(`[data-focus-key="${name}"]`)!;
const glyph = (name: string) => button(name).querySelector('svg')!;
const spacers = () => document.querySelectorAll('.player-btn-spacer');
/** Waits until the neighbour reads have settled into a slot (a button or a spacer). */
const slotsAppear = () =>
  waitFor(() =>
    expect(
      document.querySelector('[data-focus-key="prevEpisode"], [data-focus-key="nextEpisode"]'),
    ).not.toBeNull(),
  );
/** Gives reads that must not change anything time to arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('the glyphs', () => {
  it('draws every control with its Lucide icon, hidden from the accessibility tree', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2), ep(1, 3)] } });
    await mount({
      start: [playableDecision(plan(true))],
      watch: episodeWatch(1, 2, true),
    });
    await slotsAppear();
    key(KEY.up);
    const expected: Record<string, string> = {
      playPause: 'lucide-pause',
      skipBack: 'lucide-rotate-ccw',
      skipForward: 'lucide-rotate-cw',
      prevEpisode: 'lucide-skip-back',
      nextEpisode: 'lucide-skip-forward',
      audio: 'lucide-audio-lines',
      subtitles: 'lucide-captions',
      chapters: 'lucide-list-video',
      settings: 'lucide-settings',
      info: 'lucide-info',
      close: 'lucide-x',
    };
    for (const [name, className] of Object.entries(expected)) {
      const svg = glyph(name);
      expect(svg, name).toHaveClass('lucide', className);
      expect(svg, name).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('draws the play glyph while paused and the pause glyph while playing, both filled', async () => {
    const { video } = await mount();
    key(KEY.up);
    expect(glyph('playPause')).toHaveClass('lucide-pause');
    expect(glyph('playPause')).toHaveAttribute('fill', 'currentColor');
    fireEvent.pause(video);
    await waitFor(() => expect(glyph('playPause')).toHaveClass('lucide-play'));
    expect(glyph('playPause')).toHaveAttribute('fill', 'currentColor');
  });

  it('puts the skip length as text over the arrow, from the profile', async () => {
    await mount();
    key(KEY.up);
    const numbers = [...document.querySelectorAll('[data-testid="player-skip-number"]')].map(
      (e) => e.textContent,
    );
    expect(numbers).toEqual(['10', '30']);
  });

  it('has no icon component of its own any more', () => {
    expect(existsSync('src/playback/osd/icons.tsx')).toBe(false);
  });
});

describe('the transport row and the menu buttons', () => {
  it('lists back, play and forward for a movie, with no episode slot', async () => {
    await mount();
    key(KEY.up);
    expect(keysOf('.player-osd-transport')).toEqual(['skipBack', 'playPause', 'skipForward']);
    expect(spacers()).toHaveLength(0);
  });

  it('puts the episode buttons around them for an episode: previous, back, play, forward, next', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2), ep(1, 3)] } });
    await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    key(KEY.up);
    expect(keysOf('.player-osd-transport')).toEqual([
      'prevEpisode',
      'skipBack',
      'playPause',
      'skipForward',
      'nextEpisode',
    ]);
    // All four small buttons wear the same class.
    for (const name of ['prevEpisode', 'skipBack', 'skipForward', 'nextEpisode']) {
      expect(button(name), name).toHaveClass('player-btn', 'player-btn-small');
    }
  });

  it('has the five menu buttons on the right, in the web order, and nothing the TV leaves out', async () => {
    serveSeries();
    await mount({ start: [playableDecision(plan(false))], watch: episodeWatch(1, 2) });
    key(KEY.up);
    expect(keysOf('.player-osd-menus')).toEqual([
      'audio',
      'chapters',
      'subtitles',
      'settings',
      'info',
    ]);
    const labels = [...document.querySelectorAll('.player-osd button')].map((b) =>
      (b.getAttribute('aria-label') ?? '').toLowerCase(),
    );
    for (const left of ['volume', 'mute', 'marker', 'picture', 'fullscreen', 'speed', 'aspect']) {
      expect(
        labels.some((l) => l.includes(left)),
        left,
      ).toBe(false);
    }
  });

  it('shows the amber dot and the on glyph while a subtitle plays, neither without one', async () => {
    await mount({ start: [playableDecision(plan(true))], watch: watchDetail(PLAYS_SUBTITLE) });
    key(KEY.up);
    expect(screen.getByTestId('player-subtitles-dot')).toBeInTheDocument();
    expect(glyph('subtitles')).toHaveClass('lucide-captions');
    cleanup();
    await mount({ start: [playableDecision(plan(false))] });
    key(KEY.up);
    expect(screen.queryByTestId('player-subtitles-dot')).not.toBeInTheDocument();
    expect(glyph('subtitles')).toHaveClass('lucide-captions-off');
  });

  it('shows the gear with the quality in use as a pill, and only the gear without one', async () => {
    await mount({ start: [playableDecision(plan(false))] });
    key(KEY.up);
    expect(screen.getByTestId('player-quality-label')).toHaveTextContent('Auto');
    expect(button('settings')).toHaveClass('player-btn-wide');
    expect(button('info')).not.toHaveClass('player-btn-wide');
  });

  it('reads Automatisch in the pill in German', async () => {
    await mount({ lang: 'de', start: [playableDecision(plan(false))] });
    key(KEY.up);
    expect(screen.getByTestId('player-quality-label')).toHaveTextContent('Automatisch');
  });

  it('marks the focused button with its kind of class and data-focused only', async () => {
    serveSeries();
    await mount({ watch: episodeWatch(1, 2) });
    key(KEY.up);
    key(KEY.down);
    expect(focused()).toEqual(['playPause']);
    expect(button('playPause')).toHaveClass('player-btn', 'player-btn-play');
    expect(button('skipBack')).toHaveClass('player-btn', 'player-btn-small');
    expect(button('info')).toHaveClass('player-btn', 'player-btn-tool');
    key(KEY.left);
    expect(focused()).toEqual(['skipBack']);
  });

  it('does not mark a button focused while its popover is open: the focus is in the menu', async () => {
    serveSeries();
    await mount({ watch: episodeWatch(1, 2) });
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    expect(focused()).toEqual(['audio']);
    key(KEY.enter);
    await screen.findByTestId('player-menu-audio');
    expect(button('audio')).toHaveAttribute('data-focused', 'false');
    expect(button('audio')).toHaveAttribute('data-open', 'true');
    expect(focused()).not.toContain('audio');
  });
});

describe('the episode slots', () => {
  const seasons = [seasonOf(0), seasonOf(1), seasonOf(2)];

  it('shows a spacer before and a button after for the first episode, and play stays between them', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2)] } });
    await mount({ watch: episodeWatch(1, 1) });
    await slotsAppear();
    expect(document.querySelector('[data-focus-key="prevEpisode"]')).toBeNull();
    const spacer = screen.getByTestId('player-spacer-prevEpisode');
    expect(spacer).toHaveClass('player-btn-spacer');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    // The spacer sits first in the row, the play button stays at its centre.
    expect(spacer.nextElementSibling).toBe(button('skipBack'));
    expect(screen.queryByTestId('player-spacer-nextEpisode')).not.toBeInTheDocument();
  });

  it('shows a button before and a spacer after for the last episode of the last season', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2)] } });
    await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    expect(document.querySelector('[data-focus-key="nextEpisode"]')).toBeNull();
    expect(screen.getByTestId('player-spacer-nextEpisode')).toBeInTheDocument();
  });

  it('makes the spacer no control: no tabindex, no focus key, not a button, inert to the pointer', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2)] } });
    const { onEpisode } = await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    const spacer = screen.getByTestId('player-spacer-nextEpisode');
    expect(spacer.tagName).toBe('SPAN');
    expect(spacer).not.toHaveAttribute('tabindex');
    expect(spacer).not.toHaveAttribute('data-focus-key');
    key(KEY.up);
    fireEvent.mouseMove(spacer);
    expect(focused()).toEqual(['scrubber']);
    fireEvent.click(spacer);
    expect(onEpisode).not.toHaveBeenCalled();
  });

  it('has no slots while the lists load, and none for a single episode that has no neighbour', async () => {
    const seasonsAnswer = gate();
    serveSeries({
      seasons: [seasonOf(1)],
      episodes: { 1: [ep(1, 1)] },
      gates: { seasons: seasonsAnswer.promise },
    });
    await mount({ watch: episodeWatch(1, 1) });
    await settle();
    expect(spacers()).toHaveLength(0);
    key(KEY.up);
    expect(keysOf('.player-osd-transport')).toEqual(['skipBack', 'playPause', 'skipForward']);
    seasonsAnswer.release();
    await settle();
    // One episode, no next season: still no neighbour, so still the three-button cluster.
    expect(spacers()).toHaveLength(0);
    expect(keysOf('.player-osd-transport')).toEqual(['skipBack', 'playPause', 'skipForward']);
  });

  it('has no slots when the season reads fail', async () => {
    serveSeries({ seasons: 'fail', episodes: { 1: [ep(1, 1)] } });
    await mount({ watch: episodeWatch(1, 1) });
    await settle();
    expect(spacers()).toHaveLength(0);
  });

  it('waits for the season list before it shows anything: no Previous alone, then the slots', async () => {
    const seasonsAnswer = gate();
    serveSeries({
      seasons: [seasonOf(1)],
      episodes: { 1: [ep(1, 1), ep(1, 2)] },
      gates: { seasons: seasonsAnswer.promise },
    });
    await mount({ watch: episodeWatch(1, 2) });
    // The current season's episodes are in, the season list is not: no neighbours yet.
    await settle();
    expect(document.querySelector('[data-focus-key="prevEpisode"]')).toBeNull();
    expect(spacers()).toHaveLength(0);
    seasonsAnswer.release();
    await slotsAppear();
    expect(document.querySelector('[data-focus-key="prevEpisode"]')).not.toBeNull();
    expect(screen.getByTestId('player-spacer-nextEpisode')).toBeInTheDocument();
  });

  it('waits for the next season before it shows anything at a last episode, then shows Next', async () => {
    const nextSeason = gate();
    serveSeries({
      seasons: [seasonOf(1), seasonOf(2)],
      episodes: { 1: [ep(1, 1), ep(1, 2)], 2: [ep(2, 1)] },
      gates: { episodes: { 2: nextSeason.promise } },
    });
    await mount({ watch: episodeWatch(1, 2) });
    await settle();
    // Season 2 is listed but its episodes are pending: neither Previous nor a Next spacer yet.
    expect(document.querySelector('[data-focus-key="prevEpisode"]')).toBeNull();
    expect(spacers()).toHaveLength(0);
    nextSeason.release();
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="nextEpisode"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-focus-key="prevEpisode"]')).not.toBeNull();
  });

  it('shows what it has when the next season cannot be read', async () => {
    serveSeries({
      seasons: [seasonOf(1), seasonOf(2)],
      episodes: { 1: [ep(1, 1), ep(1, 2)] },
    });
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/series/:id/seasons/2/episodes`, () =>
        HttpResponse.json({ items: [] }, { status: 500 }),
      ),
    );
    await mount({ watch: episodeWatch(1, 2) });
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="prevEpisode"]')).not.toBeNull(),
    );
    expect(screen.getByTestId('player-spacer-nextEpisode')).toBeInTheDocument();
  });

  it('skips the spacers with the arrow keys', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2)] } });
    await mount({ watch: episodeWatch(1, 1) });
    await slotsAppear();
    key(KEY.up);
    key(KEY.down);
    expect(focused()).toEqual(['playPause']);
    key(KEY.left);
    expect(focused()).toEqual(['skipBack']);
    // Left of back is the spacer: the start holds, the focus does not vanish.
    key(KEY.left);
    expect(focused()).toEqual(['skipBack']);
    key(KEY.right);
    key(KEY.right);
    expect(focused()).toEqual(['skipForward']);
    key(KEY.right);
    expect(focused()).toEqual(['nextEpisode']);
    key(KEY.right);
    expect(focused()).toEqual(['audio']);
    key(KEY.left);
    expect(focused()).toEqual(['nextEpisode']);
  });

  it('goes from forward straight to the first menu button when Next is a spacer', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2)] } });
    await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    expect(focused()).toEqual(['skipForward']);
    key(KEY.right);
    expect(focused()).toEqual(['audio']);
  });

  it('moves from an open popover on the first menu button to Next when it is there, else to forward', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2), ep(1, 3)] } });
    await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    key(KEY.right);
    expect(focused()).toEqual(['audio']);
    key(KEY.enter);
    await screen.findByTestId('player-menu-audio');
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-focus-key')).toMatch(/^player-menu-/),
    );
    await pressKey(KEY.left);
    await waitFor(() => expect(focused()).toEqual(['nextEpisode']));
    cleanup();
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2)] } });
    await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    expect(focused()).toEqual(['audio']);
    key(KEY.enter);
    await screen.findByTestId('player-menu-audio');
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-focus-key')).toMatch(/^player-menu-/),
    );
    await pressKey(KEY.left);
    await waitFor(() => expect(focused()).toEqual(['skipForward']));
  });

  it('reaches the next season for Next, and never the previous season for Previous', async () => {
    const { asked } = serveSeries({
      seasons,
      episodes: { 0: [ep(0, 1)], 1: [ep(1, 1), ep(1, 2)], 2: [ep(2, 1)] },
    });
    await mount({ watch: episodeWatch(1, 2) });
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="nextEpisode"]')).not.toBeNull(),
    );
    // The last episode of season 1 has Next (season 2's first) and a Previous within the season.
    expect(document.querySelector('[data-focus-key="prevEpisode"]')).not.toBeNull();
    // Season 0 and the season after the next are never read.
    expect([...asked].sort()).toEqual(['1', '2']);
  });

  it('reads no episode list for a season the series does not list', async () => {
    const { asked } = serveSeries({
      seasons: [seasonOf(1)],
      episodes: { 1: [ep(1, 1), ep(1, 2)] },
    });
    await mount({ watch: episodeWatch(1, 2) });
    await slotsAppear();
    // The series has no season 2: asking for one would be a guess.
    expect(asked).toEqual(['1']);
  });

  it('has no Previous at the first episode of a season: the previous season is not loaded', async () => {
    serveSeries({ seasons, episodes: { 1: [ep(1, 1)], 2: [ep(2, 1), ep(2, 2)] } });
    await mount({ watch: episodeWatch(2, 1) });
    await waitFor(() =>
      expect(screen.getByTestId('player-spacer-prevEpisode')).toBeInTheDocument(),
    );
    // Season 3 does not exist, so the next of the first episode is the second of season 2.
    expect(document.querySelector('[data-focus-key="nextEpisode"]')).not.toBeNull();
  });

  it('steps over an episode that cannot play', async () => {
    serveSeries({
      seasons: [seasonOf(1)],
      episodes: { 1: [ep(1, 1), ep(1, 2, unplayable), ep(1, 3)] },
    });
    const { onEpisode } = await mount({ watch: episodeWatch(1, 1) });
    await slotsAppear();
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    key(KEY.enter);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e13', title: 'Episode 1.3' });
  });

  it('treats season 0 like any season: Next from the last special goes to season 1', async () => {
    serveSeries({
      seasons,
      episodes: { 0: [ep(0, 1), ep(0, 2)], 1: [ep(1, 1)] },
    });
    const { onEpisode } = await mount({ watch: episodeWatch(0, 2) });
    await slotsAppear();
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    key(KEY.enter);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e11', title: 'Episode 1.1' });
  });

  it('reads nothing for an episode without a series id, and shows no slots', async () => {
    const { paths } = serveSeries({
      seasons: [seasonOf(1)],
      episodes: { 1: [ep(1, 1), ep(1, 2)] },
    });
    await mount({ watch: { ...episodeWatch(1, 1), series_id: undefined } });
    await settle();
    expect(paths).toEqual([]);
    expect(spacers()).toHaveLength(0);
  });

  it('reads nothing and shows no slots for a title that is no episode, even with a series id', async () => {
    // An extra of a series may carry the series id; only an episode has neighbours.
    const { paths } = serveSeries({
      seasons: [seasonOf(1)],
      episodes: { 1: [ep(1, 1), ep(1, 2)] },
    });
    await mount({
      watch: { ...episodeWatch(1, 1), type: 'movie' },
    });
    await settle();
    expect(paths).toEqual([]);
    expect(spacers()).toHaveLength(0);
    key(KEY.up);
    expect(keysOf('.player-osd-transport')).toEqual(['skipBack', 'playPause', 'skipForward']);
  });
});

describe('pressing an episode button', () => {
  it('stops the playing session and opens the neighbour, once', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2), ep(1, 3)] } });
    const { calls, onEpisode } = await mount({ watch: episodeWatch(1, 2) });
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="nextEpisode"]')).not.toBeNull(),
    );
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    key(KEY.enter);
    expect(onEpisode).toHaveBeenCalledTimes(1);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e13', title: 'Episode 1.3' });
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.sessionId).toBe(SESSION_ID);
  });

  it('opens the previous episode at once, without restarting this one first', async () => {
    serveSeries({ seasons: [seasonOf(1)], episodes: { 1: [ep(1, 1), ep(1, 2), ep(1, 3)] } });
    const { calls, state, onEpisode } = await mount({ watch: episodeWatch(1, 2) });
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="prevEpisode"]')).not.toBeNull(),
    );
    // Well into the episode: Previous still goes to the one before, it does not seek to 0.
    state.currentTime = 1500;
    key(KEY.up);
    key(KEY.down);
    key(KEY.left);
    key(KEY.left);
    expect(focused()).toEqual(['prevEpisode']);
    key(KEY.enter);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e11', title: 'Episode 1.1' });
    expect(state.seeks).toEqual([]);
    await until(() => calls.stop.length === 1);
  });
});
