// The subtitle appearance dialog inside the real PlayerScreen: the "Appearance…" row of the Subtitles
// menu, the dialog over the playing video, Back, and a change reaching the cues on screen. Real
// timers throughout (the spatial navigation decides asynchronously).
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings, type SettingsServe } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../session/startSession';

type Subtitle = components['schemas']['SubtitleDecisionV3'];

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
  await new Promise((resolve) => setTimeout(resolve, 100));
  server.resetHandlers();
});

const SUBTITLE_URL = `/api/v2/stream/${SESSION_ID}/subtitles/0.vtt?file_id=file-1`;
const VTT = 'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nEarly cue';

const subtitle: Subtitle = {
  mode: 'render',
  inventory: [
    {
      track_id: 'sub:0',
      combined_index: 0,
      source: 'embedded',
      forced: false,
      default: false,
      hearing_impaired: false,
      delivery: 'sidecar',
      language: 'en',
    },
  ],
  artifact: { url: SUBTITLE_URL, mime_type: 'text/vtt', format: 'vtt', timing_origin_seconds: 0 },
};

interface Written {
  method: 'PUT' | 'DELETE';
  key: string;
  scope: string | null;
  value?: unknown;
}

async function mount(options: { settings?: SettingsServe; lang?: 'de' | 'en' } = {}) {
  servePlayback(server, { start: [playableDecision(playbackPlan({ subtitle }))] });
  serveSettings(server, options.settings);
  const written: Written[] = [];
  server.use(
    http.get(
      `${BASE_URL}/api/v2/stream/${SESSION_ID}/subtitles/:name`,
      () => new HttpResponse(VTT, { status: 200, headers: { 'content-type': 'text/vtt' } }),
    ),
    http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      const body = (await request.json()) as { value: unknown };
      written.push({
        method: 'PUT',
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
        value: body.value,
      });
      return HttpResponse.json({
        key: params.key,
        scope: 'profile',
        value: body.value,
        revision: 1,
      });
    }),
    http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ request, params }) => {
      written.push({
        method: 'DELETE',
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
      });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const view = renderWithSilo(
    <PlayerScreen
      contentId="m1"
      title="First Title"
      intent={{ kind: 'beginning' }}
      onExit={vi.fn()}
      onEpisode={vi.fn()}
    />,
    { session, ...(options.lang ? { lang: options.lang } : {}) },
  );
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  fireEvent.playing(video);
  await screen.findByLabelText(options.lang === 'de' ? '10 Sekunden zurück' : '10 seconds back');
  const at = (seconds: number) => {
    state.currentTime = seconds;
    fireEvent.timeUpdate(video);
  };
  return { written, state, at };
}

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const focusKey = () => document.activeElement?.getAttribute('data-focus-key');
const focusOn = (name: string) => waitFor(() => expect(focusKey()).toBe(name));
const osdFocused = (name: string) =>
  document.querySelector(`[data-focus-key="${name}"]`)?.getAttribute('data-focused') === 'true';

/** Opens the Subtitles menu from the player's button row and moves down onto "Appearance…". */
async function toAppearanceRow() {
  key(KEY.up);
  key(KEY.down);
  for (let i = 0; i < 7 && !osdFocused('subtitles'); i += 1) key(KEY.right);
  expect(osdFocused('subtitles')).toBe(true);
  key(KEY.enter);
  await screen.findByTestId('player-menu-subtitles');
  await waitFor(() => expect(focusKey()).toMatch(/^player-menu-/));
  // Off (checked: no subtitle plays), the track, then the action; the delay row is dimmed.
  for (const next of ['player-menu-subtitle-sub:0', 'player-menu-appearance']) {
    await pressKey(KEY.down);
    await focusOn(next);
  }
}

describe('the Appearance… row of the Subtitles menu', () => {
  it('stands below the delay row, with the web player’s name', async () => {
    await mount();
    key(KEY.up);
    key(KEY.down);
    for (let i = 0; i < 7 && !osdFocused('subtitles'); i += 1) key(KEY.right);
    key(KEY.enter);
    await screen.findByTestId('player-menu-subtitles');
    const row = screen.getByRole('menuitem', { name: 'Appearance…' });
    expect(row).toHaveAttribute('data-testid', 'menu-appearance');
    const delay = screen.getByTestId('menu-delay');
    expect(delay.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is called Darstellung… in German', async () => {
    await mount({ lang: 'de' });
    key(KEY.up);
    key(KEY.down);
    for (let i = 0; i < 7 && !osdFocused('subtitles'); i += 1) key(KEY.right);
    key(KEY.enter);
    await screen.findByTestId('player-menu-subtitles');
    expect(screen.getByRole('menuitem', { name: 'Darstellung…' })).toBeInTheDocument();
  });

  it('is left out where the server does not know the setting', async () => {
    await mount({ settings: { manifestRevision: 0 } });
    key(KEY.up);
    key(KEY.down);
    for (let i = 0; i < 7 && !osdFocused('subtitles'); i += 1) key(KEY.right);
    key(KEY.enter);
    await screen.findByTestId('player-menu-subtitles');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByTestId('menu-appearance')).toBeNull();
  });
});

describe('the appearance dialog over the player', () => {
  it('opens on OK while the video keeps playing and the menu and the overlay stay', async () => {
    const { state, at } = await mount();
    at(11);
    await screen.findByText('Early cue');
    await toAppearanceRow();
    expect(screen.queryByTestId('subtitle-dialog')).toBeNull();
    await pressKey(KEY.enter);
    await screen.findByTestId('subtitle-dialog');
    await focusOn('subtitle-dialog-size');
    // Nothing paused or closed behind it.
    expect(state.pause).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-menu-subtitles')).toBeInTheDocument();
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'true');
    expect(screen.getByText('Early cue')).toBeInTheDocument();
  });

  it('a click on its backdrop closes the dialog only: no play or pause, the menu stays', async () => {
    const { state } = await mount();
    await toAppearanceRow();
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('subtitle-dialog');
    // A click on the dialog itself is the dialog's.
    fireEvent.click(dialog);
    expect(screen.getByTestId('subtitle-dialog')).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog')).toBeNull());
    expect(screen.getByTestId('player-menu-subtitles')).toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
  });

  it('Back closes only the dialog and returns the focus to the row; the next Back closes the menu', async () => {
    await mount();
    await toAppearanceRow();
    await pressKey(KEY.enter);
    await screen.findByTestId('subtitle-dialog');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog')).toBeNull());
    expect(screen.getByTestId('player-menu-subtitles')).toBeInTheDocument();
    await focusOn('player-menu-appearance');
    // The player's own Back is back: it closes the menu, then the overlay, and does not leave.
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('player-menu-subtitles')).toBeNull());
    expect(screen.getByTestId('player')).toBeInTheDocument();
  });

  it('shows a change in the running video’s subtitles at once and saves it for the profile', async () => {
    const { written, at } = await mount();
    at(11);
    const cue = async () => (await screen.findByText('Early cue')).closest('p')!;
    await waitFor(async () => expect((await cue()).style.fontSize).toBe('48px'));
    await toAppearanceRow();
    await pressKey(KEY.enter);
    await screen.findByTestId('subtitle-dialog');
    await focusOn('subtitle-dialog-size');
    // Large to X-Large.
    await pressKey(KEY.right);
    await waitFor(async () => expect((await cue()).style.fontSize).toBe('60px'));
    await waitFor(() =>
      expect(written.map((w) => `${w.method} ${w.scope}`)).toEqual([
        'PUT profile',
        'DELETE profile_device',
      ]),
    );
    expect(written[0]).toMatchObject({ key: 'playback.subtitle_appearance' });
    expect((written[0]!.value as { fontSize: string }).fontSize).toBe('xlarge');
  });
});
