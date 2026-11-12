import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../api/session';
import { BASE_URL, account } from '../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../test/fakeVideo';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  servePlayback,
  terminalDecision,
  until,
  watchDetail,
  watchUserData,
  type PlaybackServerOptions,
} from '../test/playbackFixtures';
import { KEY, pressKey } from '../test/keys';
import { memoryStorage, renderWithSilo } from '../test/renderFlow';
import { serveSettings, type SettingsServe } from '../test/settingsFixtures';
import { PlayerScreen } from './PlayerScreen';
import { setResumeRewind } from './resumeRewind';
import type { StartIntent } from './resume';
import { clearInstallationCache } from './session/startSession';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
beforeEach(() => {
  // The rewind setting lives in the device storage; every test starts on its default (7 s).
  window.localStorage.clear();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
});
afterEach(async () => {
  restoreMedia();
  // Unmounting stops the session; let that request finish before the next test.
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const OK = 13;
const PLAY_PAUSE = 179;
const PLAY = 415;
const PAUSE = 19;
const LEFT = 37;
const RIGHT = 39;
const BACK = 461;
const BLUE = 406;
const UP = 38;

function key(keyCode: number) {
  fireEvent.keyDown(window, { keyCode });
}

/** A press: key down and up (a held key sends no keyup before its repeats). */
function tap(keyCode: number) {
  fireEvent.keyDown(window, { keyCode });
  fireEvent.keyUp(window, { keyCode });
}

/** Lets real time pass inside act: the skip commit waits 200 ms after the last press. */
async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Opens the overlay (the first key only shows it) and presses `keyCode` once, then lets the seek commit. */
async function skipWith(keyCode: number) {
  tap(keyCode);
  await wait(260);
}

function signedIn(token = ACCESS_TOKEN) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: token,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

function render(
  options: PlaybackServerOptions = {},
  token = ACCESS_TOKEN,
  intent?: StartIntent,
  settings: SettingsServe = {},
) {
  const calls = servePlayback(server, options);
  serveSettings(server, settings);
  const onExit = vi.fn();
  const view = renderWithSilo(
    <PlayerScreen
      contentId="m1"
      title="First Title"
      intent={intent}
      onExit={onExit}
      onEpisode={vi.fn()}
    />,
    { session: signedIn(token) },
  );
  const currentVideo = () => view.container.querySelector('video');
  return { calls, onExit, view, currentVideo };
}

async function playing(
  options: PlaybackServerOptions = {},
  firstFrame = true,
  settings: SettingsServe = {},
) {
  const ctx = render(options, ACCESS_TOKEN, undefined, settings);
  await screen.findByTestId('player');
  const video = ctx.currentVideo()!;
  // Progress and stop report the element's position only after a frame has played.
  if (firstFrame) fireEvent.playing(video);
  return { ...ctx, video, state: fakeVideo(video) };
}

describe('PlayerScreen loading view', () => {
  it('shows the centred cue on the black player layer, with no heading or title', () => {
    render();
    const loading = screen.getByTestId('player-loading');
    expect(loading).toHaveClass('player');
    const cue = loading.querySelector('.player-cue');
    expect(cue).not.toBeNull();
    expect(cue).toHaveAttribute('role', 'status');
    expect(cue).toHaveTextContent('Loading');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(loading).not.toHaveTextContent('First Title');
  });

  it('is left with Back, like any screen', () => {
    const { onExit } = render();
    screen.getByTestId('player-loading');
    key(BACK);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen playback', () => {
  it('shows a loading cue until the video plays', async () => {
    const { video } = await playing({}, false);
    // The spinner waits half a second before it shows.
    expect(screen.queryByTestId('player-cue')).not.toBeInTheDocument();
    expect(await screen.findByTestId('player-cue')).toBeInTheDocument();
    expect(video).toHaveAttribute('autoplay');
    fireEvent.playing(video);
    // It stays at least half a second once shown, then goes.
    expect(screen.getByTestId('player-cue')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('player-cue')).not.toBeInTheDocument());
    // A stall brings the cue back, again after the delay.
    fireEvent.waiting(video);
    expect(screen.queryByTestId('player-cue')).not.toBeInTheDocument();
    expect(await screen.findByTestId('player-cue')).toBeInTheDocument();
  });

  it('loads the media URL with the token for the server origin, and never renders it', async () => {
    const { video } = await playing();
    expect(video.getAttribute('src')).toBe(
      `${BASE_URL}/api/v2/stream/${SESSION_ID}?st=signed-1&token=${ACCESS_TOKEN}`,
    );
    expect(document.body.textContent).not.toContain(ACCESS_TOKEN);
    expect(document.body.textContent).not.toContain('signed-1');
  });

  it('leaves the wheel alone: the player has its own keys', async () => {
    await playing();
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    window.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('toggles play and pause with OK and with the Play/Pause key', async () => {
    const { video, state } = await playing();
    // OK with the overlay hidden acts at once; with the focus on Play/Pause it toggles again.
    key(OK);
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(state.paused).toBe(false);
    key(OK);
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(state.paused).toBe(true);
    key(PLAY_PAUSE);
    expect(state.play).toHaveBeenCalledTimes(2);
    key(PLAY_PAUSE);
    expect(state.pause).toHaveBeenCalledTimes(2);
    expect(video).toBeInTheDocument();
  });

  it('plays only on Play and pauses only on Pause', async () => {
    const { state } = await playing();
    key(PAUSE);
    expect(state.pause).not.toHaveBeenCalled();
    key(PLAY);
    expect(state.play).toHaveBeenCalledTimes(1);
    key(PLAY);
    expect(state.play).toHaveBeenCalledTimes(1);
    key(PAUSE);
    expect(state.pause).toHaveBeenCalledTimes(1);
  });

  it('toggles with a pointer click on the video while the overlay is hidden', async () => {
    const { video, state } = await playing();
    fireEvent.click(video);
    expect(state.play).toHaveBeenCalledTimes(1);
    fireEvent.click(video);
    expect(state.pause).toHaveBeenCalledTimes(1);
  });

  it('toggles with a pointer click on the video while the overlay is open', async () => {
    const { video, state } = await playing();
    key(UP);
    fireEvent.click(video);
    expect(state.play).toHaveBeenCalledTimes(1);
    fireEvent.click(video);
    expect(state.pause).toHaveBeenCalledTimes(1);
  });

  it('toggles with a click on an overlay area that has no control, and not on a control', async () => {
    const { state } = await playing();
    key(UP);
    fireEvent.click(screen.getByTestId('player-osd'));
    expect(state.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('heading', { level: 1 }));
    expect(state.pause).toHaveBeenCalledTimes(1);
    // A control does what it does and is not also a toggle.
    fireEvent.click(screen.getByRole('button', { name: '30 seconds forward' }));
    fireEvent.click(screen.getByTestId('player-scrubber'));
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(state.pause).toHaveBeenCalledTimes(1);
  });

  it('seeks by the profile defaults (10 s back, 30 s forward) and never past the ends', async () => {
    const { state } = await playing();
    state.duration = 100;
    state.currentTime = 5;
    key(UP);
    await skipWith(LEFT);
    expect(state.currentTime).toBe(0);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(30);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(60);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(90);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(100);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(100);
  });

  it('skips by the profile setting, not by a fixed amount', async () => {
    const { state } = await playing({}, true, {
      values: {
        'player.video_skip_back_seconds': 15,
        'player.video_skip_forward_seconds': 45,
      },
    });
    state.duration = 500;
    state.currentTime = 100;
    // The overlay names the amounts once the setting is known.
    await screen.findByLabelText('15 seconds back');
    await screen.findByLabelText('45 seconds forward');
    key(UP);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(145);
    await skipWith(LEFT);
    expect(state.currentTime).toBe(130);
  });

  it('bounds the seek by the source runtime while the engine knows no duration', async () => {
    const { state } = await playing({
      start: [
        playableDecision(
          playbackPlan({ source: { ...playbackPlan().source, duration_seconds: 60 } }),
        ),
      ],
    });
    state.currentTime = 55;
    key(UP);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(60);
  });

  it('seeks to the plan start after load, and keeps the container origin as the lower bound', async () => {
    const { video, state } = await playing({
      start: [
        playableDecision(
          playbackPlan({
            timeline: {
              can_seek_anywhere: true,
              player_start_seconds: 12.5,
              seek_restoration: 'player_position',
              source_start_seconds: 12.5,
              stream_origin_seconds: 0,
              timeline_offset_seconds: 0,
            },
          }),
        ),
      ],
    });
    // Matroska in Chromium reports its first timestamp as currentTime.
    state.currentTime = 7;
    fireEvent.loadedMetadata(video);
    expect(state.seeks.at(-1)).toBe(19.5);
    state.duration = 100;
    state.currentTime = 8;
    key(UP);
    await skipWith(LEFT);
    expect(state.currentTime).toBe(7);
  });

  it('shows the elapsed time and the total time', async () => {
    const { video, state } = await playing();
    state.currentTime = 75;
    fireEvent.timeUpdate(video);
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:15');
    expect(screen.getByTestId('player-total')).toHaveTextContent('1:30:00');
  });

  it('lets the video load its metadata even when it does not autoplay', async () => {
    const { currentVideo } = await playing();
    expect(currentVideo()).toHaveAttribute('preload', 'auto');
  });

  it('keeps the last time when the TV reports an unknown one (INT64_MAX nanoseconds)', async () => {
    const { video, state } = await playing();
    state.currentTime = 75;
    fireEvent.timeUpdate(video);
    state.currentTime = 9223372036.854;
    fireEvent.timeUpdate(video);
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:15');
    expect(screen.getByTestId('player-time')).not.toHaveTextContent('2562048');
  });

  it('names an episode with its series and numbers, a movie with its title only', async () => {
    await playing({
      watch: watchDetail({
        title: 'The Pilot',
        type: 'episode',
        series_title: 'Some Show',
        season_number: 1,
        episode_number: 2,
      }),
    });
    expect(screen.getByRole('heading', { hidden: true, name: 'Some Show' })).toBeInTheDocument();
    expect(screen.getByTestId('player-meta')).toHaveTextContent('S1 · E2 — THE PILOT');
  });
});

describe('PlayerScreen leaving', () => {
  it('stops with the final position on Back and returns to the list', async () => {
    const { calls, onExit, state } = await playing();
    state.currentTime = 33;
    key(BACK);
    expect(onExit).toHaveBeenCalledTimes(1);
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.sessionId).toBe(SESSION_ID);
    expect(calls.stop[0]?.body).toMatchObject({ position: 33, is_paused: true });
  });

  it('stops when the video ends, and the pause before it is not reported', async () => {
    const { calls, onExit, video, state } = await playing();
    state.currentTime = 5400;
    state.ended = true;
    fireEvent.pause(video);
    fireEvent.ended(video);
    expect(onExit).toHaveBeenCalledTimes(1);
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.body).toMatchObject({ position: 5400 });
    expect(calls.progress).toHaveLength(0);
  });

  it('hands the end of the stream to onEnded instead of leaving when the screen has one', async () => {
    const calls = servePlayback(server);
    const onExit = vi.fn();
    const onEnded = vi.fn();
    const view = renderWithSilo(
      <PlayerScreen
        contentId="m1"
        title="First Title"
        onExit={onExit}
        onEpisode={vi.fn()}
        onEnded={onEnded}
      />,
      { session: signedIn() },
    );
    await screen.findByTestId('player');
    const video = view.container.querySelector('video')!;
    const state = fakeVideo(video);
    fireEvent.playing(video);
    state.currentTime = 5400;
    state.ended = true;
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.body).toMatchObject({ position: 5400 });
  });

  it('reports a pause the viewer made at once', async () => {
    const { calls, video, state } = await playing();
    fireEvent.playing(video);
    state.currentTime = 12;
    state.paused = true;
    fireEvent.pause(video);
    await until(() => calls.progress.length === 1);
    expect(calls.progress[0]?.body).toMatchObject({ position: 12, is_paused: true });
    // A pause opens the overlay, and its play button offers to continue.
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('adds the plan timeline offset to every reported position', async () => {
    const { calls, video, state } = await playing({
      start: [
        playableDecision(
          playbackPlan({
            timeline: {
              can_seek_anywhere: false,
              player_start_seconds: 0,
              seek_restoration: 'source_position',
              source_start_seconds: 600,
              stream_origin_seconds: 600,
              timeline_offset_seconds: 600,
            },
          }),
        ),
      ],
    });
    state.currentTime = 20;
    state.paused = true;
    fireEvent.pause(video);
    await until(() => calls.progress.length === 1);
    expect(calls.progress[0]?.body.position).toBe(620);
  });

  it('stops the session when the screen goes away', async () => {
    const { calls, view, state } = await playing();
    state.currentTime = 9;
    view.unmount();
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.body).toMatchObject({ position: 9 });
  });
});

describe('PlayerScreen on a plan the server cannot seek', () => {
  const stuck = {
    start: [
      playableDecision(
        playbackPlan({
          timeline: {
            can_seek_anywhere: false,
            player_start_seconds: 0,
            seek_restoration: 'source_position',
            source_start_seconds: 0,
            stream_origin_seconds: 0,
            timeline_offset_seconds: 0,
          },
        }),
      ),
    ],
  };

  it('seeks by itself inside the seekable ranges', async () => {
    const { calls, state } = await playing(stuck);
    state.duration = 5400;
    state.seekable = [[0, 30]];
    state.currentTime = 25;
    key(UP);
    await skipWith(LEFT);
    expect(state.currentTime).toBe(15);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.replan).toHaveLength(0);
  });

  it('seeks by itself inside a later seekable range', async () => {
    const { calls, state } = await playing(stuck);
    state.duration = 5400;
    state.seekable = [[100, 200]];
    state.currentTime = 160;
    key(UP);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(190);
    await skipWith(LEFT);
    expect(state.currentTime).toBe(180);
    expect(calls.replan).toHaveLength(0);
  });

  it('asks the server to move the timeline when the target is outside the seekable ranges', async () => {
    const { calls, state, video, currentVideo } = await playing(stuck);
    state.duration = 5400;
    state.seekable = [[0, 30]];
    state.currentTime = 25;
    key(UP);
    tap(RIGHT);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'seek_reanchor',
      position_seconds: 55,
    });
    // The player did not seek on its own, and the new plan on the same stream keeps the video.
    expect(state.currentTime).toBe(25);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(currentVideo()).toBe(video);
  });

  it('does not move without a seekable range', async () => {
    const { state } = await playing(stuck);
    state.duration = 5400;
    state.currentTime = 25;
    key(UP);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(25);
  });

  it('a plan that can seek anywhere ignores the seekable ranges', async () => {
    const { state } = await playing();
    state.duration = 5400;
    state.seekable = [[0, 30]];
    state.currentTime = 25;
    key(UP);
    await skipWith(RIGHT);
    expect(state.currentTime).toBe(55);
  });
});

describe('PlayerScreen bitrate cap of the profile', () => {
  it('sends it on the start and shows it in the Info panel', async () => {
    const { calls } = await playing({}, true, { values: { 'playback.max_bitrate_kbps': 8000 } });
    expect(calls.start[0]?.body.bandwidth_cap_kbps).toBe(8000);
    key(BLUE);
    const panel = await screen.findByTestId('player-info');
    expect(panel).toHaveTextContent('Maximum bitrate');
    expect(panel).toHaveTextContent('8 Mbit/s');
  });

  it('sends nothing and shows no line without a cap', async () => {
    const { calls } = await playing();
    expect(calls.start[0]?.body).not.toHaveProperty('bandwidth_cap_kbps');
    key(BLUE);
    const panel = await screen.findByTestId('player-info');
    expect(panel).not.toHaveTextContent('Maximum bitrate');
  });
});

describe('PlayerScreen Info on the blue key', () => {
  const osdVisible = () => screen.getByTestId('player-osd').getAttribute('data-visible') === 'true';
  const infoButton = () => screen.getByRole('button', { name: 'Info' });

  it('shows the overlay and opens Info with the focus on its button, and a second press closes it', async () => {
    await playing();
    expect(osdVisible()).toBe(false);
    expect(screen.queryByTestId('player-info')).not.toBeInTheDocument();
    key(BLUE);
    expect(osdVisible()).toBe(true);
    expect(await screen.findByTestId('player-info')).toBeInTheDocument();
    expect(infoButton()).toHaveFocus();
    expect(infoButton()).toHaveAttribute('aria-pressed', 'true');
    key(BLUE);
    expect(screen.queryByTestId('player-info')).not.toBeInTheDocument();
    // The overlay stays, with the focus on the button.
    expect(osdVisible()).toBe(true);
    expect(infoButton()).toHaveFocus();
  });

  it('opens Info too while the overlay is up on another button', async () => {
    await playing();
    key(UP);
    expect(osdVisible()).toBe(true);
    key(BLUE);
    expect(await screen.findByTestId('player-info')).toBeInTheDocument();
    expect(infoButton()).toHaveFocus();
  });

  it('has no separate diagnostics window any more: the blue key shows the Info and nothing else', async () => {
    const { state } = await playing();
    state.videoWidth = 1920;
    state.videoHeight = 1080;
    key(BLUE);
    const panel = await screen.findByTestId('player-info');
    expect(screen.queryByTestId('player-diagnostics')).not.toBeInTheDocument();
    expect(document.querySelector('.player-diag')).toBeNull();
    // What the engine reports: the element's size, the plan's route and the file's codecs.
    expect(panel).toHaveTextContent('1920×1080');
    expect(panel).toHaveTextContent('Direct play');
    expect(panel).toHaveTextContent('H.264');
    expect(panel).toHaveTextContent('AAC');
    expect(panel.textContent).not.toContain(SESSION_ID);
  });

  it('renders no diagnostics element in the playing view, also with a media error', async () => {
    const { video, state } = await playing();
    state.error = { code: 3, message: 'decode' };
    fireEvent.error(video);
    await waitFor(() => expect(document.querySelector('video')).not.toBe(video));
    expect(screen.queryByTestId('player-diagnostics')).toBeNull();
    expect(document.querySelector('.player-diag')).toBeNull();
    key(BLUE);
    await screen.findByTestId('player-info');
    expect(screen.queryByTestId('player-diagnostics')).toBeNull();
    expect(document.querySelector('.player-diag')).toBeNull();
  });

  it('works before the first frame, so a load that hangs can be looked at', async () => {
    await playing({}, false);
    key(BLUE);
    expect(await screen.findByTestId('player-info')).toBeInTheDocument();
    key(BLUE);
    expect(screen.queryByTestId('player-info')).not.toBeInTheDocument();
  });

  it('shows the last media error with its code, and never the token or the media URL', async () => {
    const { video, state } = await playing();
    const src = video.getAttribute('src')!;
    state.error = { code: 3, message: `PIPELINE_ERROR_DECODE for ${src} (${ACCESS_TOKEN})` };
    fireEvent.error(video);
    // The failure is recovered with a new plan; Info on the new load names the error.
    await waitFor(() => expect(document.querySelector('video')).not.toBe(video));
    key(BLUE);
    const panel = await screen.findByTestId('player-info');
    await waitFor(() => expect(panel).toHaveTextContent('3 · PIPELINE_ERROR_DECODE'));
    const shown = document.body.textContent ?? '';
    expect(shown).not.toContain(ACCESS_TOKEN);
    expect(shown).not.toContain('signed-1');
    expect(shown).not.toContain('/api/v2/stream/');
    expect(shown).not.toContain(src);
  });
});

describe('PlayerScreen failure', () => {
  it('shows the terminal reason when the server ends a viewer-requested replan (a seek)', async () => {
    const stuckPlan = playbackPlan({
      timeline: {
        can_seek_anywhere: false,
        player_start_seconds: 0,
        seek_restoration: 'source_position',
        source_start_seconds: 0,
        stream_origin_seconds: 0,
        timeline_offset_seconds: 0,
      },
    });
    const { state } = await playing({
      start: [playableDecision(stuckPlan)],
      replan: [terminalDecision('No route fits.')],
    });
    state.duration = 5400;
    state.seekable = [[0, 30]];
    state.currentTime = 25;
    key(UP);
    tap(RIGHT);
    const error = await screen.findByTestId('player-error');
    // No media error is behind this one: the server's reason is the code.
    expect(within(error).getByTestId('player-error-details').textContent).toBe(
      `Direct play · adaptation_exhausted · ${SESSION_ID.slice(0, 8)}`,
    );
  });

  it('replans and loads the new plan; a plan already tried shows the error with Back', async () => {
    const { calls, onExit, view, video, currentVideo } = await playing();
    const first = video.getAttribute('src');
    fakeVideo(video).error = { code: 3, message: 'decode' };
    fireEvent.error(video);
    await waitFor(() => expect(currentVideo()).not.toBe(video));
    const second = currentVideo()!;
    expect(calls.replan).toHaveLength(1);
    expect(second.getAttribute('src')).toBeTruthy();
    expect(second).not.toBe(video);
    expect(first).toBeTruthy();

    fakeVideo(second).error = { code: 4, message: 'unsupported' };
    fireEvent.error(second);
    const error = await screen.findByTestId('player-error');
    expect(error).toHaveTextContent('Playback failed.');
    // The second recovery came back with the plan already tried: a loop, so it ends here.
    expect(calls.replan).toHaveLength(2);
    expect(calls.replan[1]?.body).toMatchObject({
      attempt_count: 2,
      attempted_plan_keys: ['v3:key-1', 'v3:key-2'],
    });
    expect(currentVideo()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    // The list unmounts the player; that ends the session.
    view.unmount();
    await until(() => calls.stop.length === 1);
  });

  it('hides the token and its URL-encoded form on the error screen', async () => {
    const token = 'tok/en+x y';
    const message = `failed ${token} and ${encodeURIComponent(token)}`;
    const ctx = render({ replan: [terminalDecision(message)] }, token);
    await screen.findByTestId('player');
    const video = ctx.currentVideo()!;
    fakeVideo(video).error = { code: 3, message };
    fireEvent.error(video);
    const error = await screen.findByTestId('player-error');
    await waitFor(() => expect(error).toHaveTextContent('[hidden]'));
    expect(error.textContent).not.toContain(token);
    expect(error.textContent).not.toContain(encodeURIComponent(token));
  });

  it('shows one small line under the message: the route, the error code and a short session id', async () => {
    const { video } = await playing();
    fakeVideo(video).error = { code: 3, message: 'decode' };
    fireEvent.error(video);
    await waitFor(() => expect(document.querySelector('video')).not.toBe(video));
    // The second failure meets the loop guard and ends the playback.
    const second = document.querySelector('video')!;
    fakeVideo(second).error = { code: 4, message: 'unsupported' };
    fireEvent.error(second);
    const error = await screen.findByTestId('player-error');
    const details = within(error).getByTestId('player-error-details');
    expect(details).toHaveTextContent(`Direct play · 4 · ${SESSION_ID.slice(0, 8)}`);
    expect(details.textContent).not.toContain(SESSION_ID);
    // No block of diagnostics, no URL and no token.
    expect(within(error).queryByTestId('player-diagnostics')).toBeNull();
    expect(error.querySelector('dl')).toBeNull();
    expect(error.textContent).not.toContain(ACCESS_TOKEN);
    expect(error.textContent).not.toContain('/api/v2/stream/');
    expect(error.textContent).not.toContain('signed-');
  });

  it('shows exactly the first 8 characters of a 36-character session id', async () => {
    const uuid = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab';
    const retry = playbackPlan({
      plan_id: 'plan:2',
      plan_attempt_key: 'v3:key-2',
      session_id: uuid,
    });
    const { video } = await playing({
      start: [playableDecision(playbackPlan({ session_id: uuid }), uuid)],
      replan: [playableDecision(retry, uuid)],
    });
    fakeVideo(video).error = { code: 3, message: 'decode' };
    fireEvent.error(video);
    await waitFor(() => expect(document.querySelector('video')).not.toBe(video));
    const second = document.querySelector('video')!;
    fakeVideo(second).error = { code: 4, message: 'unsupported' };
    fireEvent.error(second);
    const error = await screen.findByTestId('player-error');
    expect(within(error).getByTestId('player-error-details').textContent).toBe(
      'Direct play · 4 · a1b2c3d4',
    );
  });

  it('puts the media error code first when there is one, and the terminal reason otherwise', async () => {
    const { video } = await playing({ replan: [terminalDecision('No route fits.')] });
    fakeVideo(video).error = { code: 3, message: 'decode' };
    fireEvent.error(video);
    const error = await screen.findByTestId('player-error');
    expect(within(error).getByTestId('player-error-details')).toHaveTextContent(
      `Direct play · 3 · ${SESSION_ID.slice(0, 8)}`,
    );
  });

  it('shows the terminal reason when the start itself is refused, with dashes for what is not known', async () => {
    render({ start: [terminalDecision('No route fits.')] });
    const error = await screen.findByTestId('player-error');
    expect(within(error).getByTestId('player-error-details')).toHaveTextContent(
      '- · adaptation_exhausted · -',
    );
  });

  it('says so when the server does not support the protocol, with Back', async () => {
    const { calls, onExit } = render({
      capabilities: playbackCapabilities({ protocol_versions: [2] }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This server does not support this playback protocol.',
    );
    expect(calls.start).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus());
    key(BACK);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen resume prompt', () => {
  const resumable = { watch: watchDetail({ user_data: watchUserData({ position_seconds: 90 }) }) };

  it('is shown when there is a position and the title is not played, with Resume focused', async () => {
    const { calls } = render(resumable);
    const prompt = await screen.findByTestId('resume-prompt');
    expect(prompt).toHaveTextContent('Resume from 1:30');
    expect(prompt).toHaveTextContent('Start over');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume from 1:30' })).toHaveFocus(),
    );
    expect(calls.start).toHaveLength(0);
  });

  it.each([
    ['no user data', undefined],
    ['position zero', watchUserData({ position_seconds: 0 })],
    ['a position of 30 s or less', watchUserData({ position_seconds: 30 })],
    ['a position at the very end', watchUserData({ position_seconds: 5398 })],
  ])('is not shown for %s', async (_name, userData) => {
    const { calls } = render({ watch: watchDetail({ user_data: userData }) });
    await screen.findByTestId('player');
    expect(screen.queryByTestId('resume-prompt')).not.toBeInTheDocument();
    expect(calls.start[0]?.body.start_position).toBe(0);
  });

  it('is shown for a played title that has a saved position (a rewatch)', async () => {
    render({
      watch: watchDetail({ user_data: watchUserData({ position_seconds: 362.464, played: true }) }),
    });
    expect(await screen.findByTestId('resume-prompt')).toHaveTextContent('Resume from 6:02');
  });

  it('Resume starts at the saved position rewound by the setting (7 s by default)', async () => {
    const { calls } = render(resumable);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume from 1:30' }));
    await screen.findByTestId('player');
    expect(calls.start[0]?.body.start_position).toBe(83);
  });

  it('Resume starts exactly at the saved position when the rewind is off', async () => {
    setResumeRewind(0);
    const { calls } = render(resumable);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume from 1:30' }));
    await screen.findByTestId('player');
    expect(calls.start[0]?.body.start_position).toBe(90);
  });

  it('Start over starts at zero, explicitly', async () => {
    const { calls } = render(resumable);
    await screen.findByTestId('resume-prompt');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume from 1:30' })).toHaveFocus(),
    );
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Start over' })).toHaveFocus();
    await pressKey(KEY.enter);
    await screen.findByTestId('player');
    expect(calls.start[0]?.body.start_position).toBe(0);
  });

  it('resumes rewound without asking for the intent resume', async () => {
    setResumeRewind(15);
    const { calls } = render(
      { watch: watchDetail({ user_data: watchUserData({ position_seconds: 754 }) }) },
      ACCESS_TOKEN,
      { kind: 'resume' },
    );
    await screen.findByTestId('player');
    expect(screen.queryByTestId('resume-prompt')).not.toBeInTheDocument();
    expect(calls.start).toHaveLength(1);
    expect(calls.start[0]?.body.start_position).toBe(739);
  });

  it('starts from the beginning without asking for the intent beginning', async () => {
    const { calls } = render(resumable, ACCESS_TOKEN, { kind: 'beginning' });
    await screen.findByTestId('player');
    expect(screen.queryByTestId('resume-prompt')).not.toBeInTheDocument();
    expect(calls.start[0]?.body.start_position).toBe(0);
  });

  it('Back leaves without starting anything', async () => {
    const { calls, onExit } = render(resumable);
    await screen.findByTestId('resume-prompt');
    key(BACK);
    expect(onExit).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.start).toHaveLength(0);
    expect(calls.stop).toHaveLength(0);
  });
});
