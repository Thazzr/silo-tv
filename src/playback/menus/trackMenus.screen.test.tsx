// The Audio and Subtitles menus on the real PlayerScreen: the buttons, the rows, the keys, a pick as
// a track_change replan, the save of an applied pick for the series or movie, the refusal, and the
// subtitle delay row. Real timers throughout (the spatial navigation decides asynchronously).
/// <reference types="node" />
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import type { components } from '../../api/generated/schema';
import { BASE_URL, account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import { KEY, pressKey } from '../../test/keys';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackPlan,
  servePlayback,
  terminalDecision,
  until,
  watchDetail,
  watchVersion,
  type PlaybackServerOptions,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings, type SettingsServe } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../session/startSession';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
/** What the settings PUT answers with and when: a test sets these, every test starts without. */
let settingsAnswer: ((sent: unknown) => unknown) | null = null;
let settingsGate: Promise<void> | null = null;

beforeEach(() => {
  settingsAnswer = null;
  settingsGate = null;
  window.localStorage.clear();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
});
afterEach(async () => {
  vi.useRealTimers();
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const AUDIO: S['WatchAudioTrack'][] = [
  { default: true, title: 'English', language: 'en', codec: 'ac3', channels: 6 },
  { default: false, title: 'German', language: 'de', codec: 'aac', channels: 2 },
];

const subtitle = (n: number, over: Partial<S['SubtitleInventoryItemV3']> = {}) => ({
  track_id: `sub:${n}`,
  combined_index: n,
  source: 'embedded',
  forced: false,
  default: false,
  hearing_impaired: false,
  delivery: 'sidecar',
  language: 'en',
  ...over,
});
const INVENTORY = [
  subtitle(0, { language: 'en' }),
  subtitle(1, { language: 'de', forced: true }),
  subtitle(2, { language: 'de', hearing_impaired: true }),
];

const AUDIO_0 = { id: 'file:file-1:audio:0', index: 0 };

/** A plan with both tracks lists; every plan of the test sits on a stream of its own. */
const plan = (n: number, tracks: S['SelectedTracksV3'] = { audio: AUDIO_0 }) =>
  playbackPlan({
    plan_id: `plan:${n}`,
    plan_attempt_key: `v3:key-${n}`,
    stream: {
      container: 'mp4',
      header_refresh: 'none',
      headers: {},
      protocol: 'http',
      url: `/api/v2/stream/${SESSION_ID}?st=signed-${n}`,
    },
    selected_tracks: tracks,
    subtitle: { mode: 'sidecar', inventory: INVENTORY },
  });

const withTracks = (over: Partial<S['WatchDetail']> = {}) =>
  watchDetail({ versions: [watchVersion({ audio_tracks: AUDIO })], ...over });

// The profile's subtitle settings decide what a playback starts with and what an audio pick keeps.
/** An explicit "None": the settings pick no subtitle for any audio. */
const NO_SUBTITLE = { effective_subtitle_language: '' };
/** The remembered track is the German forced one: a start whose plan plays it needs no change. */
const KEEPS_SUB_1 = {
  effective_subtitle_mode: 'always',
  effective_subtitle_language: 'de',
  effective_subtitle_track_signature: {
    source: 'embedded',
    language: 'de',
    forced: true,
    hearing_impaired: false,
  },
};

interface Puts {
  audio: { id: string; body: Record<string, unknown>; profile: string | null }[];
  subtitle: { id: string; body: Record<string, unknown> }[];
  settings: { key: string; scope: string | null; value: unknown }[];
  settingDeletes: { key: string; scope: string | null }[];
}

function servePuts(): Puts {
  const puts: Puts = { audio: [], subtitle: [], settings: [], settingDeletes: [] };
  server.use(
    http.put(`${BASE_URL}/api/v2/audio-prefs/:id`, async ({ request, params }) => {
      puts.audio.push({
        id: String(params.id),
        body: (await request.json()) as Record<string, unknown>,
        profile: request.headers.get('X-Profile-Id'),
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.put(`${BASE_URL}/api/v2/subtitle-prefs/:id`, async ({ request, params }) => {
      puts.subtitle.push({
        id: String(params.id),
        body: (await request.json()) as Record<string, unknown>,
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      const body = (await request.json()) as { value: unknown };
      puts.settings.push({
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
        value: body.value,
      });
      await settingsGate;
      return HttpResponse.json({
        key: params.key,
        scope: new URL(request.url).searchParams.get('scope'),
        value: settingsAnswer ? settingsAnswer(body.value) : body.value,
        revision: 1,
      });
    }),
    http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ request, params }) => {
      puts.settingDeletes.push({
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
      });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return puts;
}

interface MountOptions extends PlaybackServerOptions {
  settings?: SettingsServe;
  lang?: 'de' | 'en';
}

/**
 * A player that plays the German forced subtitle: the delay's buttons are dimmed while no subtitle
 * plays, so the tests of the delay start from here.
 */
const withSubtitle = (): MountOptions => ({
  watch: withTracks(KEEPS_SUB_1),
  start: [playableDecision(plan(1, { audio: AUDIO_0, subtitle: { id: 'sub:1', index: 1 } }))],
});

async function mount(options: MountOptions = {}) {
  const { settings, lang, ...playback } = options;
  const calls = servePlayback(server, {
    start: [playableDecision(plan(1))],
    watch: withTracks(),
    ...playback,
  });
  serveSettings(server, settings);
  const puts = servePuts();
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const view = renderWithSilo(
    <PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} onEpisode={vi.fn()} />,
    {
      session,
      lang,
    },
  );
  await screen.findByTestId('player');
  const video = () => view.container.querySelector('video')!;
  fakeVideo(video()).duration = 5400;
  fireEvent.playing(video());
  await screen.findByLabelText(lang === 'de' ? '10 Sekunden zurück' : '10 seconds back');
  return { calls, puts, view, video };
}

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const menu = (id: string) => screen.queryByTestId(`player-menu-${id}`);
const focusKey = () => document.activeElement?.getAttribute('data-focus-key');
const focusOn = (name: string) => waitFor(() => expect(focusKey()).toBe(name));
const osdFocused = (name: string) =>
  document.querySelector(`[data-focus-key="${name}"]`)?.getAttribute('data-focused') === 'true';

function toButton(name: string) {
  key(KEY.up);
  key(KEY.down);
  for (let i = 0; i < 7 && !osdFocused(name); i += 1) key(KEY.right);
  expect(osdFocused(name)).toBe(true);
}

async function openMenu(name: 'audio' | 'subtitles') {
  toButton(name);
  key(KEY.enter);
  await screen.findByTestId(`player-menu-${name}`);
  await waitFor(() => expect(focusKey()).toMatch(/^player-menu-/));
}

const delayText = () => screen.getByTestId('menu-delay-value').textContent;
const later = () => screen.getByTestId('delay-plus');
const earlier = () => screen.getByTestId('delay-minus');
const reset = () => screen.getByTestId('delay-reset');
const mountDelay = (options: MountOptions = {}) => mount({ ...withSubtitle(), ...options });

/** Opens the menu with a subtitle playing and moves down onto the delay row (its minus button). */
async function toDelayRow() {
  await openMenu('subtitles');
  for (let i = 0; i < 2; i += 1) await pressKey(KEY.down);
  await focusOn('player-menu-delay-minus');
}

const menuButtons = () =>
  Array.from(document.querySelectorAll('.player-osd-menus button')).map((el) =>
    el.getAttribute('data-focus-key'),
  );

describe('the buttons', () => {
  it('are absent for a file with one audio track and no subtitle', async () => {
    await mount({
      watch: watchDetail({ versions: [watchVersion({ audio_tracks: [AUDIO[0]!] })] }),
      start: [playableDecision({ ...plan(1), subtitle: { mode: 'none', inventory: [] } })],
    });
    expect(menuButtons()).toEqual(['info']);
  });

  it('are Audio and Subtitles, before the others, when the file has a choice', async () => {
    await mount();
    expect(menuButtons()).toEqual(['audio', 'subtitles', 'info']);
    // The overlay is hidden until a key shows it: the buttons are still there by name.
    expect(screen.getByRole('button', { name: 'Audio', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subtitles', hidden: true })).toBeInTheDocument();
  });

  it('leave out Audio for a single audio track, but keep Subtitles for the delay', async () => {
    await mount({
      watch: watchDetail({ versions: [watchVersion({ audio_tracks: [AUDIO[0]!] })] }),
    });
    expect(menuButtons()).toEqual(['subtitles', 'info']);
  });

  it('do not break a plan that leaves the subtitle member out', async () => {
    const { subtitle: _left, ...bare } = plan(1);
    void _left;
    await mount({
      watch: watchDetail({ versions: [watchVersion({ audio_tracks: [AUDIO[0]!] })] }),
      start: [playableDecision(bare as unknown as ReturnType<typeof plan>)],
    });
    expect(menuButtons()).toEqual(['info']);
  });

  it('are in German too', async () => {
    await mount({ lang: 'de' });
    expect(screen.getByRole('button', { name: 'Ton', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Untertitel', hidden: true })).toBeInTheDocument();
  });
});

describe('the audio menu', () => {
  it("lists the version's tracks as title, codec and channels, with the playing one checked", async () => {
    await mount();
    await openMenu('audio');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(screen.getAllByTestId('audio-title').map((el) => el.textContent)).toEqual([
      'English',
      'German',
    ]);
    expect(screen.getAllByTestId('audio-codec').map((el) => el.textContent)).toEqual([
      'AC3',
      'AAC',
    ]);
    expect(screen.getAllByTestId('audio-channels').map((el) => el.textContent)).toEqual([
      '5.1',
      'Stereo',
    ]);
    // Opens on the checked row.
    await focusOn('player-menu-audio-0');
  });

  describe('the rows', () => {
    const TRACKS: S['WatchAudioTrack'][] = [
      {
        default: true,
        title: 'Main mix',
        language: 'en',
        codec: 'eac3',
        profile: 'Dolby Digital Plus + Dolby Atmos',
        channels: 8,
        layout: '7.1',
        bitrate: 768,
        sample_rate: 48000,
        bit_depth: 24,
      },
      { default: false, language: 'de', codec: 'aac', channels: 2 },
      { default: false, embedded_title: 'Kommentar', language: 'de', codec: 'ac3', channels: 6 },
    ];
    const open = async (lang?: 'de' | 'en') => {
      await mount({
        ...(lang ? { lang } : {}),
        watch: watchDetail({ versions: [watchVersion({ audio_tracks: TRACKS })] }),
      });
      await openMenu('audio');
    };
    const row = (n: number) => screen.getAllByRole('menuitemradio')[n]!;

    it('has the heading "Audio" above the rows', async () => {
      await open();
      expect(
        screen.getByTestId('player-menu-audio').querySelector('.player-menu-heading'),
      ).toHaveTextContent('Audio');
    });

    it('shows title, codec, channels and the Default badge, and the meta line', async () => {
      await open();
      const first = within(row(0));
      expect(first.getByTestId('audio-title')).toHaveTextContent('Main mix');
      expect(first.getByTestId('audio-codec')).toHaveTextContent('DD+ Atmos');
      expect(first.getByTestId('audio-channels')).toHaveTextContent('7.1');
      expect(first.getByTestId('audio-default')).toHaveTextContent('Default');
      expect(first.getByTestId('audio-meta')).toHaveTextContent(
        'English · 7.1 · 768 kbps · 48,000 Hz · 24-bit',
      );
    });

    it('names a track by its embedded title, or by language, codec and channels', async () => {
      await open();
      expect(within(row(1)).getByTestId('audio-title')).toHaveTextContent('de aac Stereo');
      expect(within(row(2)).getByTestId('audio-title')).toHaveTextContent('Kommentar');
    });

    it('shows the Default badge on the default track only', async () => {
      await open();
      expect(screen.getAllByTestId('audio-default')).toHaveLength(1);
      expect(within(row(1)).queryByTestId('audio-default')).toBeNull();
    });

    it('writes the labels in German, with the thousands grouped the German way', async () => {
      await open('de');
      const first = within(row(0));
      expect(first.getByTestId('audio-default')).toHaveTextContent('Standard');
      expect(first.getByTestId('audio-meta')).toHaveTextContent(
        'Englisch · 7.1 · 768 kbps · 48.000 Hz · 24 Bit',
      );
      expect(within(row(1)).getByTestId('audio-channels')).toHaveTextContent('Stereo');
    });

    it('colours only the row that plays', async () => {
      await open();
      expect(row(0)).toHaveAttribute('data-checked', 'true');
      expect(row(1)).toHaveAttribute('data-checked', 'false');
      const css = readFileSync('src/styles/player-menus.css', 'utf-8');
      expect(css).toMatch(/\.player-menu-track\[data-checked='true'\] \{\s*color: #60a5fa;/);
    });
  });

  it('walks with Up and Down, and Back closes it with the focus on its button', async () => {
    await mount();
    await openMenu('audio');
    await focusOn('player-menu-audio-0');
    await pressKey(KEY.down);
    await focusOn('player-menu-audio-1');
    await pressKey(KEY.down);
    expect(focusKey()).toBe('player-menu-audio-1');
    await pressKey(KEY.up);
    await focusOn('player-menu-audio-0');
    key(KEY.back);
    expect(menu('audio')).toBeNull();
    expect(osdFocused('audio')).toBe(true);
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveFocus();
  });

  it('sends a track_change with the track and the subtitle the plan plays', async () => {
    const { calls } = await mount({
      watch: withTracks(KEEPS_SUB_1),
      start: [playableDecision(plan(1, { audio: AUDIO_0, subtitle: { id: 'sub:1', index: 1 } }))],
      replan: [
        playableDecision(
          plan(2, {
            audio: { id: 'file:file-1:audio:1', index: 1 },
            subtitle: { id: 'sub:1', index: 1 },
          }),
        ),
      ],
    });
    await openMenu('audio');
    await pressKey(KEY.down);
    await focusOn('player-menu-audio-1');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'track_change',
      selected_tracks: {
        audio: { id: 'file:file-1:audio:1', index: 1 },
        subtitle: { id: 'sub:1', index: 1 },
      },
    });
  });

  it('sends no subtitle when the plan plays none: that stays off', async () => {
    const { calls } = await mount({
      watch: withTracks(NO_SUBTITLE),
      replan: [playableDecision(plan(2))],
    });
    await openMenu('audio');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    const tracks = (calls.replan[0]?.body as { selected_tracks: Record<string, unknown> })
      .selected_tracks;
    expect(tracks).toEqual({ audio: { id: 'file:file-1:audio:1', index: 1 } });
  });

  it('keeps the bandwidth cap on the replan, like every other one', async () => {
    const { calls } = await mount({
      settings: { values: { 'playback.max_bitrate_kbps': 8000 } },
      replan: [playableDecision(plan(2))],
    });
    await openMenu('audio');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({ bandwidth_cap_kbps: 8000 });
  });

  it('saves an applied pick for the movie, then closes the menu with the focus on the button', async () => {
    const { calls, puts, video } = await mount({
      replan: [playableDecision(plan(2, { audio: { id: 'file:file-1:audio:1', index: 1 } }))],
    });
    await openMenu('audio');
    const before = video();
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await waitFor(() => expect(video()).not.toBe(before));
    await waitFor(() => expect(menu('audio')).toBeNull());
    await until(() => puts.audio.length === 1);
    expect(puts.audio[0]).toEqual({
      id: 'm1',
      profile: 'p1',
      body: {
        audio_track_index: 1,
        audio_language: 'de',
        track_signature: { language: 'de', codec: 'aac', channels: 2, title: 'German' },
      },
    });
    expect(puts.subtitle).toHaveLength(0);
    const button = screen.getByRole('button', { name: 'Audio' });
    expect(button).toHaveAttribute('data-focused', 'true');
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("saves an episode's pick under its series", async () => {
    const { calls, puts } = await mount({
      watch: withTracks({ type: 'episode', series_id: 'series-7' }),
      replan: [playableDecision(plan(2, { audio: { id: 'file:file-1:audio:1', index: 1 } }))],
    });
    await openMenu('audio');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await until(() => puts.audio.length === 1);
    expect(puts.audio[0]?.id).toBe('series-7');
  });

  it('sends nothing for the track that already plays', async () => {
    const { calls, puts } = await mount();
    await openMenu('audio');
    await focusOn('player-menu-audio-0');
    await pressKey(KEY.enter);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls.replan).toHaveLength(0);
    expect(puts.audio).toHaveLength(0);
    expect(menu('audio')).not.toBeNull();
  });

  it('says so when the pick is refused, keeps the menu open and saves nothing', async () => {
    const { calls, puts, video } = await mount();
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Bad Request', status: 400, code: 'invalid_track' },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const before = video();
    await openMenu('audio');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('menu-audio-note')).toHaveTextContent(
      "This track isn't available right now.",
    );
    expect(video()).toBe(before);
    expect(calls.stop).toHaveLength(0);
    expect(menu('audio')).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(puts.audio).toHaveLength(0);
  });

  it('says it in German', async () => {
    await mount({ lang: 'de' });
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Bad Request', status: 400, code: 'invalid_track' },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await openMenu('audio');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('menu-audio-note')).toHaveTextContent(
      'Diese Spur geht gerade nicht.',
    );
  });
});

describe('the subtitles menu', () => {
  it('lists Off and the inventory in order, and checks the playing one', async () => {
    await mount(withSubtitle());
    await openMenu('subtitles');
    const rows = screen.getAllByRole('menuitemradio');
    expect(screen.getAllByTestId('subtitle-language').map((el) => el.textContent)).toEqual([
      'English',
      'German',
      'German',
    ]);
    expect(rows[0]).toHaveTextContent('Off');
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    await focusOn('player-menu-subtitle-sub:1');
  });

  it('starts on the subtitle the profile settings pick, and the menu checks it', async () => {
    const { calls } = await mount({
      settings: {
        values: { 'playback.subtitle_mode': 'always', 'playback.subtitle_language': 'de' },
      },
      replan: [playableDecision(plan(2, { audio: AUDIO_0, subtitle: { id: 'sub:2', index: 2 } }))],
    });
    // The title stores no subtitle settings, so the profile's apply: the best German track.
    expect(calls.replan).toHaveLength(1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'track_change',
      selected_tracks: { audio: AUDIO_0, subtitle: { id: 'sub:2', index: 2 } },
    });
    await openMenu('subtitles');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ]);
  });

  it('checks Off, and opens on it, when the plan plays no subtitle', async () => {
    await mount();
    await openMenu('subtitles');
    expect(screen.getAllByRole('menuitemradio')[0]).toHaveAttribute('aria-checked', 'true');
    await focusOn('player-menu-subtitle-off');
  });

  it('walks through the tracks and the delay row into Appearance, and holds at the ends', async () => {
    await mount(withSubtitle());
    await openMenu('subtitles');
    await focusOn('player-menu-subtitle-sub:1');
    for (const next of [
      'player-menu-subtitle-sub:2',
      'player-menu-delay-minus',
      'player-menu-appearance',
    ]) {
      await pressKey(KEY.down);
      await focusOn(next);
    }
    await pressKey(KEY.down);
    expect(focusKey()).toBe('player-menu-appearance');
    // Up leaves Appearance for the delay row and that for the last track; Up on the first row holds.
    await pressKey(KEY.up);
    await focusOn('player-menu-delay-minus');
    await pressKey(KEY.up);
    await focusOn('player-menu-subtitle-sub:2');
    for (const prev of ['sub:1', 'sub:0', 'off']) {
      await pressKey(KEY.up);
      await focusOn(`player-menu-subtitle-${prev}`);
    }
    await pressKey(KEY.up);
    expect(focusKey()).toBe('player-menu-subtitle-off');
    key(KEY.back);
    expect(menu('subtitles')).toBeNull();
    expect(screen.getByRole('button', { name: 'Subtitles' })).toHaveFocus();
  });

  describe('the rows', () => {
    const MIXED = [
      subtitle(0, { track_id: 'd1', language: 'fr', source: 'downloaded', codec: 'srt' }),
      subtitle(1, { track_id: 'x1', language: 'de', source: 'external', codec: 'subrip' }),
      subtitle(2, {
        track_id: 'e1',
        language: 'de',
        source: 'embedded',
        codec: 'hdmv_pgs_subtitle',
        label: 'German (Forced)',
      }),
      subtitle(3, { track_id: 'e2', language: 'en', source: 'embedded', label: 'English' }),
    ];
    const open = async (lang?: 'de' | 'en') => {
      await mount({
        ...(lang ? { lang } : {}),
        start: [playableDecision({ ...plan(1), subtitle: { mode: 'sidecar', inventory: MIXED } })],
      });
      await openMenu('subtitles');
    };
    const row = (n: number) => screen.getAllByRole('menuitemradio')[n + 1]!;

    it('orders embedded, external, then downloaded tracks', async () => {
      await open();
      expect(screen.getAllByTestId('subtitle-source').map((el) => el.textContent)).toEqual([
        'Embedded',
        'Embedded',
        'External',
        'Downloaded',
      ]);
      expect(screen.getAllByTestId('subtitle-language').map((el) => el.textContent)).toEqual([
        'German',
        'English',
        'German',
        'French',
      ]);
    });

    it('shows the format badge, none for an unknown codec, before the source badge', async () => {
      await open();
      expect(screen.getAllByTestId('subtitle-format').map((el) => el.textContent)).toEqual([
        'PGS',
        'SRT',
        'SRT',
      ]);
      expect(within(row(1)).queryByTestId('subtitle-format')).toBeNull();
      const badges = row(0).querySelectorAll('.player-badge');
      expect(Array.from(badges).map((el) => el.getAttribute('data-testid'))).toEqual([
        'subtitle-format',
        'subtitle-source',
      ]);
    });

    it('writes the source in German', async () => {
      await open('de');
      expect(screen.getAllByTestId('subtitle-source').map((el) => el.textContent)).toEqual([
        'Eingebettet',
        'Eingebettet',
        'Extern',
        'Heruntergeladen',
      ]);
    });

    it("shows the track's label only when it says more than the language", async () => {
      await open();
      expect(within(row(0)).getByTestId('subtitle-detail')).toHaveTextContent('German (Forced)');
      // The label "English" is the language's own name.
      expect(within(row(1)).queryByTestId('subtitle-detail')).toBeNull();
      expect(screen.getAllByTestId('subtitle-detail')).toHaveLength(1);
    });

    it('has no forced or SDH badge of its own', async () => {
      await mount({
        start: [
          playableDecision({
            ...plan(1),
            subtitle: {
              mode: 'sidecar',
              inventory: [subtitle(0, { language: 'fr', forced: true, hearing_impaired: true })],
            },
          }),
        ],
      });
      await openMenu('subtitles');
      expect(
        within(screen.getByTestId('player-menu-subtitles')).queryByText(/forced|SDH/i),
      ).toBeNull();
    });
  });

  it('sends a track_change with the track and the audio the plan plays', async () => {
    const { calls, puts } = await mount({
      replan: [playableDecision(plan(2, { audio: AUDIO_0, subtitle: { id: 'sub:2', index: 2 } }))],
    });
    await openMenu('subtitles');
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.down);
    await focusOn('player-menu-subtitle-sub:2');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'track_change',
      selected_tracks: { audio: AUDIO_0, subtitle: { id: 'sub:2', index: 2 } },
    });
    await until(() => puts.subtitle.length === 1);
    expect(puts.subtitle[0]).toEqual({
      id: 'm1',
      body: {
        subtitle_track_index: 2,
        subtitle_mode: 'always',
        subtitle_language: 'de',
        track_signature: {
          source: 'embedded',
          language: 'de',
          forced: false,
          hearing_impaired: true,
        },
      },
    });
    expect(puts.audio).toHaveLength(0);
    await waitFor(() => expect(menu('subtitles')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Subtitles' })).toHaveFocus());
  });

  it("saves a pick's language and mode as series settings, like the web app", async () => {
    const { calls, puts } = await mount({
      replan: [playableDecision(plan(2, { audio: AUDIO_0, subtitle: { id: 'sub:2', index: 2 } }))],
    });
    await openMenu('subtitles');
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.down);
    await focusOn('player-menu-subtitle-sub:2');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await until(() => puts.settings.length === 2 && puts.subtitle.length === 1);
    expect(puts.settings).toEqual([
      { key: 'playback.subtitle_language', scope: 'profile_series', value: 'de' },
      { key: 'playback.subtitle_mode', scope: 'profile_series', value: 'always' },
    ]);
  });

  it('Off sends the audio and no subtitle, and saves mode off with index -1', async () => {
    const { calls, puts } = await mount({
      watch: withTracks(KEEPS_SUB_1),
      start: [playableDecision(plan(1, { audio: AUDIO_0, subtitle: { id: 'sub:1', index: 1 } }))],
      replan: [playableDecision(plan(2, { audio: AUDIO_0 }))],
    });
    await openMenu('subtitles');
    await focusOn('player-menu-subtitle-sub:1');
    await pressKey(KEY.up);
    await focusOn('player-menu-subtitle-sub:0');
    await pressKey(KEY.up);
    await focusOn('player-menu-subtitle-off');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(
      (calls.replan[0]?.body as { selected_tracks: Record<string, unknown> }).selected_tracks,
    ).toEqual({ audio: AUDIO_0 });
    await until(() => puts.subtitle.length === 1);
    expect(puts.subtitle[0]?.body).toEqual({
      subtitle_track_index: -1,
      subtitle_mode: 'off',
      subtitle_language: '',
    });
    await until(() => puts.settings.length === 2);
    expect(puts.settings).toEqual([
      { key: 'playback.subtitle_language', scope: 'profile_series', value: null },
      { key: 'playback.subtitle_mode', scope: 'profile_series', value: 'off' },
    ]);
  });

  it('treats a subtitle_* terminal as a refused pick: notice, menu open, nothing saved, playing on', async () => {
    const { calls, puts, video } = await mount({
      replan: [
        {
          ...terminalDecision('No route shows it.'),
          terminal: {
            message: 'No route shows it.',
            reason: 'subtitle_codec_unsupported',
            retryable: false,
          },
        },
      ],
    });
    const before = video();
    await openMenu('subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('menu-subtitles-note')).toHaveTextContent(
      "This track isn't available right now.",
    );
    expect(screen.queryByTestId('player-error')).not.toBeInTheDocument();
    expect(video()).toBe(before);
    expect(calls.stop).toHaveLength(0);
    expect(menu('subtitles')).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(puts.subtitle).toHaveLength(0);
    expect(puts.settings).toHaveLength(0);
  });

  it('still ends playback for another terminal answer to the pick', async () => {
    await mount({ replan: [terminalDecision('Nothing fits.')] });
    await openMenu('subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('player-error')).toBeInTheDocument();
  });
});

describe('the subtitle delay', () => {
  const useClock = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
  it.each([
    [300, '+300 ms'],
    [-100, '−100 ms'],
    [0, '0 ms'],
  ])('shows the stored value %i as %s (signed, with U+2212 for minus)', async (stored, shown) => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': stored } } });
    await openMenu('subtitles');
    await waitFor(() => expect(delayText()).toBe(shown));
  });

  it('is one line: the label, then minus, the value, plus and reset', async () => {
    await mountDelay({ lang: 'de' });
    await openMenu('subtitles');
    const row = screen.getByRole('group', { name: 'Verzögerung' });
    expect(row.textContent).toBe('Verzögerung0 msZurücksetzen');
    expect(
      Array.from(row.querySelectorAll('button')).map((el) => el.getAttribute('data-testid')),
    ).toEqual(['delay-minus', 'delay-plus', 'delay-reset']);
    expect(earlier()).toHaveAccessibleName('Untertitelverzögerung 100 ms früher');
    expect(later()).toHaveAccessibleName('Untertitelverzögerung 100 ms später');
  });

  it('moves 100 ms per press: plus adds, minus takes away, and the menu stays open', async () => {
    await mountDelay();
    await toDelayRow();
    await pressKey(KEY.right);
    await focusOn('player-menu-delay-plus');
    await pressKey(KEY.enter);
    await pressKey(KEY.enter);
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+300 ms');
    await pressKey(KEY.left);
    await focusOn('player-menu-delay-minus');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+200 ms');
    expect(menu('subtitles')).not.toBeNull();
  });

  it('resets to 0 with OK on Reset, and the focus moves on to plus', async () => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': 300 } } });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('+300 ms'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusOn('player-menu-delay-reset');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('0 ms');
    // Reset is dimmed at 0 and cannot hold the focus: the nearest enabled button takes it.
    expect(reset()).toBeDisabled();
    await focusOn('player-menu-delay-plus');
  });

  it('dims minus at −10 000 ms, and plus at +10 000 ms, and moves the focus to the neighbour', async () => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': 9900 } } });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('+9900 ms'));
    await pressKey(KEY.right);
    await focusOn('player-menu-delay-plus');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+10000 ms');
    expect(later()).toBeDisabled();
    expect(earlier()).toBeEnabled();
    expect(reset()).toBeEnabled();
    // Plus ran into its limit: the focus goes to the nearest enabled button, the left one on a tie.
    await focusOn('player-menu-delay-minus');
  });

  it('dims minus at −10 000 ms and keeps plus and reset', async () => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': -9900 } } });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('−9900 ms'));
    await pressKey(KEY.enter);
    expect(delayText()).toBe('−10000 ms');
    expect(earlier()).toBeDisabled();
    expect(later()).toBeEnabled();
    expect(reset()).toBeEnabled();
    await focusOn('player-menu-delay-plus');
  });

  it('enables minus and plus and dims reset at 0 ms', async () => {
    await mountDelay();
    await openMenu('subtitles');
    expect([earlier(), later(), reset()].map((el) => (el as HTMLButtonElement).disabled)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('dims all three buttons while no subtitle plays, and Down from the tracks skips them for Appearance', async () => {
    await mount({ settings: { values: { 'player.subtitle_sync_ms': 300 } } });
    await openMenu('subtitles');
    expect([earlier(), later(), reset()].map((el) => (el as HTMLButtonElement).disabled)).toEqual([
      true,
      true,
      true,
    ]);
    // They are visible, only dimmed.
    expect(screen.getByTestId('menu-delay-value')).toBeInTheDocument();
    for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
    await focusOn('player-menu-appearance');
  });

  it('skips a dimmed button with Left and Right: plus to reset, with minus dimmed', async () => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': -10_000 } } });
    await openMenu('subtitles');
    await waitFor(() => expect(delayText()).toBe('−10000 ms'));
    for (let i = 0; i < 2; i += 1) await pressKey(KEY.down);
    // Minus is dimmed, so the row is entered on plus.
    await focusOn('player-menu-delay-plus');
    await pressKey(KEY.right);
    await focusOn('player-menu-delay-reset');
    await pressKey(KEY.left);
    await focusOn('player-menu-delay-plus');
    await pressKey(KEY.left);
    // Nothing further left to move to: the press leaves the menu for the button beside it.
    await waitFor(() => expect(menu('subtitles')).toBeNull());
  });

  it('skips a dimmed middle button: reset is next to minus when plus is dimmed', async () => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': 10_000 } } });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('+10000 ms'));
    await pressKey(KEY.right);
    await focusOn('player-menu-delay-reset');
  });

  it('acts on OK on each of the three buttons', async () => {
    await mountDelay({ settings: { values: { 'player.subtitle_sync_ms': 200 } } });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('+200 ms'));
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+100 ms');
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+200 ms');
    await pressKey(KEY.right);
    await focusOn('player-menu-delay-reset');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('0 ms');
  });

  it('makes each of the three buttons a target of at least 75 px', () => {
    const css = readFileSync('src/styles/player-menus.css', 'utf-8');
    const control = /\.player-menu-control \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(control).toContain('min-width: var(--target)');
    expect(control).toContain('height: var(--target)');
  });

  it('shifts the cues the overlay draws, at once: later hides a cue that has just begun', async () => {
    const cueUrl = `/api/v2/stream/${SESSION_ID}/subtitles/0.vtt?file_id=file-1`;
    server.use(
      http.get(
        `${BASE_URL}/api/v2/stream/${SESSION_ID}/subtitles/:name`,
        () =>
          new HttpResponse(['WEBVTT', '', '00:00:10.000 --> 00:00:12.000', 'A cue'].join('\n'), {
            status: 200,
            headers: { 'content-type': 'text/vtt' },
          }),
      ),
    );
    const base = plan(1, { audio: AUDIO_0, subtitle: { id: 'sub:1', index: 1 } });
    const { video } = await mountDelay({
      start: [
        playableDecision({
          ...base,
          subtitle: {
            mode: 'render',
            inventory: INVENTORY,
            artifact: {
              url: cueUrl,
              mime_type: 'text/vtt',
              format: 'vtt',
              timing_origin_seconds: 0,
            },
          },
        }),
      ],
    });
    const state = fakeVideo(video());
    state.currentTime = 10.1;
    fireEvent.timeUpdate(video());
    expect(await screen.findByText('A cue')).toBeInTheDocument();
    await toDelayRow();
    for (let i = 0; i < 3; i += 1) fireEvent.click(later());
    await waitFor(() => expect(screen.queryByText('A cue')).not.toBeInTheDocument());
    // Earlier again, by six presses: the cue is back, 300 ms before it would have begun.
    for (let i = 0; i < 6; i += 1) fireEvent.click(earlier());
    state.currentTime = 9.8;
    fireEvent.timeUpdate(video());
    expect(await screen.findByText('A cue')).toBeInTheDocument();
  });

  it('writes once, 600 ms after the last press, at the profile scope from revision 19 on', async () => {
    const { puts } = await mountDelay({ settings: { manifestRevision: 19 } });
    await toDelayRow();
    // A fake clock that also runs with real time, so the requests still go through; installed once
    // the menu is open, so the debounce timer is the fake one.
    useClock();
    for (let i = 0; i < 3; i += 1) fireEvent.click(later());
    // Not yet: the value is only written once the viewer stops pressing.
    await advance(599);
    expect(puts.settings).toHaveLength(0);
    await advance(1);
    await until(() => puts.settings.length === 1, 2000);
    expect(puts.settings).toEqual([
      { key: 'player.subtitle_sync_ms', scope: 'profile', value: 300 },
    ]);
    // The device's own row would outrank the profile's, so it is dropped.
    await until(() => puts.settingDeletes.length === 1);
    expect(puts.settingDeletes).toEqual([
      { key: 'player.subtitle_sync_ms', scope: 'profile_device' },
    ]);
  });

  it('keeps pressing from waiting for an earlier write: each press moves the 600 ms on', async () => {
    const { puts } = await mountDelay({ settings: { manifestRevision: 40 } });
    await toDelayRow();
    useClock();
    fireEvent.click(later());
    await advance(300);
    fireEvent.click(later());
    // 600 ms after the first press, but only 300 after the last: nothing is written yet.
    await advance(299);
    expect(puts.settings).toHaveLength(0);
    // The first press's 600 ms are over now; the earlier timer must be gone.
    await advance(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts.settings).toHaveLength(0);
    await advance(300);
    await until(() => puts.settings.length === 1, 2000);
    expect(puts.settings[0]?.value).toBe(200);
  });

  it('writes at the device scope before revision 19, and drops nothing', async () => {
    const { puts } = await mountDelay({ settings: { manifestRevision: 18 } });
    await toDelayRow();
    await pressKey(KEY.enter);
    await until(() => puts.settings.length === 1, 2000);
    expect(puts.settings).toEqual([
      { key: 'player.subtitle_sync_ms', scope: 'profile_device', value: -100 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(puts.settingDeletes).toHaveLength(0);
  });

  it('keeps the change for this viewing when the server has no settings contract', async () => {
    const { puts } = await mountDelay({ settings: { capabilities: 'fail' } });
    await toDelayRow();
    fireEvent.click(later());
    expect(delayText()).toBe('+100 ms');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(puts.settings).toHaveLength(0);
    expect(delayText()).toBe('+100 ms');
  });

  it('writes a pending value when the player is left', async () => {
    const { puts, view } = await mountDelay();
    await toDelayRow();
    fireEvent.click(later());
    view.unmount();
    await until(() => puts.settings.length === 1, 2000);
    expect(puts.settings[0]?.value).toBe(100);
  });
});

// --- Picks in flight, refusals, names and the delay's write, one by one -----------------------------

/** The replan answers: the first ones as listed, a gate holds the one marked `gated`. */
function replanSequence(answers: ('refuse' | 'gated')[]) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const bodies: unknown[] = [];
  server.use(
    http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, async ({ request }) => {
      const answer = answers[Math.min(bodies.length, answers.length - 1)];
      bodies.push(await request.json());
      if (answer === 'refuse') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Bad Request', status: 400, code: 'invalid_track' },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        );
      }
      await held;
      return HttpResponse.json(
        playableDecision(plan(2, { audio: { id: 'file:file-1:audio:1', index: 1 } })),
      );
    }),
  );
  return { release, bodies };
}

describe('the audio menu in detail', () => {
  const german = () => screen.getByRole('menuitemradio', { name: /German/ });

  it('is a named dialog and menu, with no note until a pick is refused', async () => {
    await mount();
    await openMenu('audio');
    expect(screen.getByRole('dialog', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-audio-note')).not.toBeInTheDocument();
  });

  it('opens on the track that plays, and on the first when the plan names none', async () => {
    await mount({
      watch: withTracks(NO_SUBTITLE),
      start: [playableDecision(plan(1, { audio: { id: 'file:file-1:audio:1', index: 1 } }))],
    });
    await openMenu('audio');
    await focusOn('player-menu-audio-1');
  });

  it('opens on the first track when the plan plays none', async () => {
    await mount({ start: [playableDecision(plan(1, {}))] });
    await openMenu('audio');
    await focusOn('player-menu-audio-0');
  });

  it('clears the note when the next pick starts, and takes another pick after a refusal', async () => {
    await mount();
    const { release, bodies } = replanSequence(['refuse', 'gated']);
    await openMenu('audio');
    fireEvent.click(german());
    expect(await screen.findByTestId('menu-audio-note')).toBeInTheDocument();
    fireEvent.click(german());
    await until(() => bodies.length === 2);
    expect(screen.queryByTestId('menu-audio-note')).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(menu('audio')).toBeNull());
  });

  it('ignores a second pick while one is in flight', async () => {
    await mount();
    const { release, bodies } = replanSequence(['gated']);
    await openMenu('audio');
    fireEvent.click(german());
    fireEvent.click(german());
    await until(() => bodies.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(bodies).toHaveLength(1);
    // The second press was not even tried: it would have come back "busy" and shown the note.
    expect(screen.queryByTestId('menu-audio-note')).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(menu('audio')).toBeNull());
  });
});

describe('the subtitles menu in detail', () => {
  const row = (name: RegExp) => screen.getByRole('menuitemradio', { name });

  it('is a named dialog, menu and delay group, with no note until a pick is refused', async () => {
    await mount();
    await openMenu('subtitles');
    expect(screen.getByRole('dialog', { name: 'Subtitles' })).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Subtitles' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Delay' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-subtitles-note')).not.toBeInTheDocument();
  });

  it('clears the note when the next pick starts, and takes another pick after a refusal', async () => {
    await mount();
    const { release, bodies } = replanSequence(['refuse', 'gated']);
    await openMenu('subtitles');
    fireEvent.click(row(/English/));
    expect(await screen.findByTestId('menu-subtitles-note')).toBeInTheDocument();
    fireEvent.click(row(/English/));
    await until(() => bodies.length === 2);
    expect(screen.queryByTestId('menu-subtitles-note')).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(menu('subtitles')).toBeNull());
  });

  it('ignores a second pick while one is in flight', async () => {
    await mount();
    const { release, bodies } = replanSequence(['gated']);
    await openMenu('subtitles');
    fireEvent.click(row(/English/));
    fireEvent.click(screen.getAllByRole('menuitemradio', { name: /German/ })[0]!);
    await until(() => bodies.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(bodies).toHaveLength(1);
    // The second press was not even tried: it would have come back "busy" and shown the note.
    expect(screen.queryByTestId('menu-subtitles-note')).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(menu('subtitles')).toBeNull());
  });
});

describe('the delay write in detail', () => {
  const useClock = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

  it('writes nothing when the player closes without a press', async () => {
    const { puts, view } = await mount();
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts.settings).toHaveLength(0);
  });

  it('writes nothing for a press the limit swallows', async () => {
    const { puts } = await mountDelay({
      settings: { values: { 'player.subtitle_sync_ms': 10_000 } },
    });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('+10000 ms'));
    useClock();
    // Plus is dimmed at the limit: a click on it does nothing.
    fireEvent.click(later());
    await advance(700);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(puts.settings).toHaveLength(0);
  });

  it('writes 0 for a press on Reset, like any other change', async () => {
    const { puts } = await mountDelay({
      settings: { values: { 'player.subtitle_sync_ms': 300 }, manifestRevision: 19 },
    });
    await toDelayRow();
    await waitFor(() => expect(delayText()).toBe('+300 ms'));
    useClock();
    fireEvent.click(reset());
    await advance(600);
    await until(() => puts.settings.length === 1, 2000);
    expect(puts.settings).toEqual([{ key: 'player.subtitle_sync_ms', scope: 'profile', value: 0 }]);
  });

  it('shows what the server stored once the write is answered, not what was sent', async () => {
    settingsAnswer = () => 200;
    // Before revision 19 the write is the device's own and no re-read follows, so the answer shows.
    const { puts } = await mountDelay({ settings: { manifestRevision: 18 } });
    await toDelayRow();
    useClock();
    for (let i = 0; i < 3; i += 1) fireEvent.click(later());
    expect(delayText()).toBe('+300 ms');
    await advance(600);
    await until(() => puts.settings.length === 1, 2000);
    await waitFor(() => expect(delayText()).toBe('+200 ms'));
  });

  it('keeps a newer press while the write for an older one is still out', async () => {
    let release!: () => void;
    settingsGate = new Promise<void>((resolve) => (release = resolve));
    const { puts } = await mountDelay();
    await toDelayRow();
    useClock();
    fireEvent.click(later());
    await advance(600);
    await until(() => puts.settings.length === 1, 2000);
    fireEvent.click(later());
    expect(delayText()).toBe('+200 ms');
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The answer of the first write must not wipe the second press.
    expect(delayText()).toBe('+200 ms');
    await advance(600);
    await until(() => puts.settings.length === 2, 2000);
    expect(puts.settings.map((put) => put.value)).toEqual([100, 200]);
  });
});
