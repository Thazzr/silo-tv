// The Audio and Subtitles menus on the real PlayerScreen: the buttons, the rows, the keys, a pick as
// a track_change replan, the save of an applied pick for the series or movie, the refusal, and the
// subtitle delay row. Real timers throughout (the spatial navigation decides asynchronously).
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
  { default: true, language: 'en', codec: 'ac3', channels: 6 },
  { default: false, language: 'de', codec: 'aac', channels: 2 },
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
    <PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} />,
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
  it("lists the version's tracks as language, codec and channels, with the playing one checked", async () => {
    await mount();
    await openMenu('audio');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((row) => row.textContent)).toEqual([
      'English · AC-3 · 5.1',
      'German · AAC · Stereo',
    ]);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // Opens on the checked row.
    await focusOn('player-menu-audio-0');
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
    const { calls } = await mount({ replan: [playableDecision(plan(2))] });
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
        track_signature: { language: 'de', codec: 'aac', channels: 2 },
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
  it('lists Off and the inventory in order with the flags, and checks the playing one', async () => {
    await mount({
      start: [playableDecision(plan(1, { audio: AUDIO_0, subtitle: { id: 'sub:1', index: 1 } }))],
    });
    await openMenu('subtitles');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Off',
      'English',
      'GermanForced',
      'GermanSDH',
    ]);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    await focusOn('player-menu-subtitle-sub:1');
  });

  it('checks Off, and opens on it, when the plan plays no subtitle', async () => {
    await mount();
    await openMenu('subtitles');
    expect(screen.getAllByRole('menuitemradio')[0]).toHaveAttribute('aria-checked', 'true');
    await focusOn('player-menu-subtitle-off');
  });

  it('walks through the tracks into the delay rows, and holds at the ends', async () => {
    await mount();
    await openMenu('subtitles');
    for (const next of [
      'player-menu-subtitle-sub:0',
      'player-menu-subtitle-sub:1',
      'player-menu-subtitle-sub:2',
      'player-menu-delay-earlier',
      'player-menu-delay-later',
    ]) {
      await pressKey(KEY.down);
      await focusOn(next);
    }
    await pressKey(KEY.down);
    expect(focusKey()).toBe('player-menu-delay-later');
    key(KEY.back);
    expect(menu('subtitles')).toBeNull();
    expect(screen.getByRole('button', { name: 'Subtitles' })).toHaveFocus();
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

  it('Off sends the audio and no subtitle, and saves mode off with index -1', async () => {
    const { calls, puts } = await mount({
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
  const delayText = () => screen.getByTestId('menu-delay-value').textContent;
  const later = () => screen.getByRole('menuitem', { name: /Later/ });

  async function toDelayRows() {
    await openMenu('subtitles');
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await focusOn('player-menu-delay-earlier');
  }

  it("shows the stored value as signed seconds with the language's decimal separator", async () => {
    await mount({ settings: { values: { 'player.subtitle_sync_ms': 300 } } });
    await openMenu('subtitles');
    await waitFor(() => expect(delayText()).toBe('+0.3 s'));
  });

  it('writes a decimal comma in German', async () => {
    await mount({ lang: 'de', settings: { values: { 'player.subtitle_sync_ms': -1500 } } });
    await openMenu('subtitles');
    await waitFor(() => expect(delayText()).toBe('-1,5 s'));
  });

  it('moves 100 ms per press: Later adds, Earlier takes away, and the menu stays open', async () => {
    await mount();
    await toDelayRows();
    expect(delayText()).toBe('0.0 s');
    await pressKey(KEY.down);
    await focusOn('player-menu-delay-later');
    await pressKey(KEY.enter);
    await pressKey(KEY.enter);
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+0.3 s');
    await pressKey(KEY.up);
    await focusOn('player-menu-delay-earlier');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+0.2 s');
    expect(menu('subtitles')).not.toBeNull();
  });

  it('stops at plus and minus 10 s', async () => {
    await mount({ settings: { values: { 'player.subtitle_sync_ms': 9900 } } });
    await toDelayRows();
    await waitFor(() => expect(delayText()).toBe('+9.9 s'));
    await pressKey(KEY.down);
    await focusOn('player-menu-delay-later');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+10.0 s');
    await pressKey(KEY.enter);
    expect(delayText()).toBe('+10.0 s');
  });

  it('stops at minus 10 s', async () => {
    await mount({ settings: { values: { 'player.subtitle_sync_ms': -9900 } } });
    await toDelayRows();
    await waitFor(() => expect(delayText()).toBe('-9.9 s'));
    await pressKey(KEY.enter);
    await pressKey(KEY.enter);
    expect(delayText()).toBe('-10.0 s');
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
    const base = plan(1);
    const { video } = await mount({
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
    await toDelayRows();
    for (let i = 0; i < 3; i += 1) fireEvent.click(later());
    await waitFor(() => expect(screen.queryByText('A cue')).not.toBeInTheDocument());
    // Earlier again, by six presses: the cue is back, 0.3 s before it would have begun.
    for (let i = 0; i < 6; i += 1)
      fireEvent.click(screen.getByRole('menuitem', { name: /Earlier/ }));
    state.currentTime = 9.8;
    fireEvent.timeUpdate(video());
    expect(await screen.findByText('A cue')).toBeInTheDocument();
  });

  it('writes once, 600 ms after the last press, at the profile scope from revision 19 on', async () => {
    const { puts } = await mount({ settings: { manifestRevision: 19 } });
    await toDelayRows();
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
    const { puts } = await mount({ settings: { manifestRevision: 40 } });
    await toDelayRows();
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
    const { puts } = await mount({ settings: { manifestRevision: 18 } });
    await toDelayRows();
    await pressKey(KEY.enter);
    await until(() => puts.settings.length === 1, 2000);
    expect(puts.settings).toEqual([
      { key: 'player.subtitle_sync_ms', scope: 'profile_device', value: -100 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(puts.settingDeletes).toHaveLength(0);
  });

  it('keeps the change for this viewing when the server has no settings contract', async () => {
    const { puts } = await mount({ settings: { capabilities: 'fail' } });
    await toDelayRows();
    fireEvent.click(later());
    expect(delayText()).toBe('+0.1 s');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(puts.settings).toHaveLength(0);
    expect(delayText()).toBe('+0.1 s');
  });

  it('writes a pending value when the player is left', async () => {
    const { puts, view } = await mount();
    await toDelayRows();
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
    expect(screen.getByRole('group', { name: 'Subtitle delay' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-subtitles-note')).not.toBeInTheDocument();
  });

  it('shows the flags only on the rows that have them, joined by a dot', async () => {
    const both = { ...INVENTORY[2]!, forced: true };
    await mount({
      start: [
        playableDecision({
          ...plan(1),
          subtitle: { mode: 'sidecar', inventory: [INVENTORY[0]!, both] },
        }),
      ],
    });
    await openMenu('subtitles');
    const flags = screen.getAllByTestId('menu-flags');
    expect(flags.map((el) => el.textContent)).toEqual(['Forced · SDH']);
  });

  it('names the delay in the heading, and the step on each row', async () => {
    await mount({ settings: { values: { 'player.subtitle_sync_ms': 300 } } });
    await openMenu('subtitles');
    await waitFor(() =>
      expect(
        screen.getByTestId('menu-delay').querySelector('.player-menu-heading'),
      ).toHaveTextContent('Subtitle delay · +0.3 s'),
    );
    expect(screen.getByRole('menuitem', { name: /Earlier/ })).toHaveTextContent('-0.1 s');
    expect(screen.getByRole('menuitem', { name: /Later/ })).toHaveTextContent('+0.1 s');
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
  const later = () => screen.getByRole('menuitem', { name: /Later/ });
  const delayText = () => screen.getByTestId('menu-delay-value').textContent;

  async function toDelayRows() {
    await openMenu('subtitles');
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await focusOn('player-menu-delay-earlier');
  }

  it('writes nothing when the player closes without a press', async () => {
    const { puts, view } = await mount();
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts.settings).toHaveLength(0);
  });

  it('writes nothing for a press the limit swallows', async () => {
    const { puts } = await mount({ settings: { values: { 'player.subtitle_sync_ms': 10_000 } } });
    await toDelayRows();
    await waitFor(() => expect(delayText()).toBe('+10.0 s'));
    useClock();
    fireEvent.click(later());
    await advance(700);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(puts.settings).toHaveLength(0);
  });

  it('shows what the server stored once the write is answered, not what was sent', async () => {
    settingsAnswer = () => 200;
    // Before revision 19 the write is the device's own and no re-read follows, so the answer shows.
    const { puts } = await mount({ settings: { manifestRevision: 18 } });
    await toDelayRows();
    useClock();
    for (let i = 0; i < 3; i += 1) fireEvent.click(later());
    expect(delayText()).toBe('+0.3 s');
    await advance(600);
    await until(() => puts.settings.length === 1, 2000);
    await waitFor(() => expect(delayText()).toBe('+0.2 s'));
  });

  it('keeps a newer press while the write for an older one is still out', async () => {
    let release!: () => void;
    settingsGate = new Promise<void>((resolve) => (release = resolve));
    const { puts } = await mount();
    await toDelayRows();
    useClock();
    fireEvent.click(later());
    await advance(600);
    await until(() => puts.settings.length === 1, 2000);
    fireEvent.click(later());
    expect(delayText()).toBe('+0.2 s');
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The answer of the first write must not wipe the second press.
    expect(delayText()).toBe('+0.2 s');
    await advance(600);
    await until(() => puts.settings.length === 2, 2000);
    expect(puts.settings.map((put) => put.value)).toEqual([100, 200]);
  });
});
