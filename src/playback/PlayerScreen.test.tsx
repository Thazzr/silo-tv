import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
  until,
  watchDetail,
  watchUserData,
  type PlaybackServerOptions,
} from '../test/playbackFixtures';
import { KEY, pressKey } from '../test/keys';
import { memoryStorage, renderWithSilo } from '../test/renderFlow';
import { PlayerScreen } from './PlayerScreen';
import { clearInstallationCache } from './usePlaybackSession';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
beforeEach(() => {
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

function key(keyCode: number) {
  fireEvent.keyDown(window, { keyCode });
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

function render(options: PlaybackServerOptions = {}, token = ACCESS_TOKEN) {
  const calls = servePlayback(server, options);
  const onExit = vi.fn();
  const view = renderWithSilo(<PlayerScreen contentId="m1" title="First Title" onExit={onExit} />, {
    session: signedIn(token),
  });
  const currentVideo = () => view.container.querySelector('video');
  return { calls, onExit, view, currentVideo };
}

async function playing(options: PlaybackServerOptions = {}) {
  const ctx = render(options);
  await screen.findByTestId('player');
  const video = ctx.currentVideo()!;
  return { ...ctx, video, state: fakeVideo(video) };
}

describe('PlayerScreen playback', () => {
  it('shows a loading cue until the video plays', async () => {
    const { video } = await playing();
    expect(screen.getByTestId('player-cue')).toBeInTheDocument();
    expect(video).toHaveAttribute('autoplay');
    fireEvent.playing(video);
    expect(screen.queryByTestId('player-cue')).not.toBeInTheDocument();
    // A stall brings the cue back.
    fireEvent.waiting(video);
    expect(screen.getByTestId('player-cue')).toBeInTheDocument();
  });

  it('loads the media URL with the token for the server origin, and never renders it', async () => {
    const { video } = await playing();
    expect(video.getAttribute('src')).toBe(
      `${BASE_URL}/api/v2/stream/${SESSION_ID}?st=signed-1&token=${ACCESS_TOKEN}`,
    );
    expect(document.body.textContent).not.toContain(ACCESS_TOKEN);
    expect(document.body.textContent).not.toContain('signed-1');
  });

  it('toggles play and pause with OK and with the Play/Pause key', async () => {
    const { video, state } = await playing();
    key(OK);
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(state.paused).toBe(false);
    key(PLAY_PAUSE);
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(state.paused).toBe(true);
    key(PLAY_PAUSE);
    expect(state.play).toHaveBeenCalledTimes(2);
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

  it('toggles with a pointer click on the video', async () => {
    const { video, state } = await playing();
    fireEvent.click(video);
    expect(state.play).toHaveBeenCalledTimes(1);
    fireEvent.click(video);
    expect(state.pause).toHaveBeenCalledTimes(1);
  });

  it('seeks 10 seconds with Left and Right and never past the ends', async () => {
    const { state } = await playing();
    state.duration = 100;
    state.currentTime = 5;
    key(LEFT);
    expect(state.currentTime).toBe(0);
    key(RIGHT);
    expect(state.currentTime).toBe(10);
    state.currentTime = 95;
    key(RIGHT);
    expect(state.currentTime).toBe(100);
    key(RIGHT);
    expect(state.currentTime).toBe(100);
    state.currentTime = 50;
    key(LEFT);
    expect(state.currentTime).toBe(40);
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
    key(RIGHT);
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
    key(LEFT);
    expect(state.currentTime).toBe(7);
  });

  it('shows the position and the runtime', async () => {
    const { video, state } = await playing();
    state.currentTime = 75;
    fireEvent.timeUpdate(video);
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:15 / 1:30:00');
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

  it('reports a pause the viewer made at once', async () => {
    const { calls, video, state } = await playing();
    fireEvent.playing(video);
    state.currentTime = 12;
    state.paused = true;
    fireEvent.pause(video);
    await until(() => calls.progress.length === 1);
    expect(calls.progress[0]?.body).toMatchObject({ position: 12, is_paused: true });
    expect(screen.getByText('Paused')).toBeInTheDocument();
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

  it('seeks inside the seekable ranges and clamps to the nearest end', async () => {
    const { state } = await playing(stuck);
    state.duration = 5400;
    state.seekable = [[0, 30]];
    state.currentTime = 25;
    key(RIGHT);
    expect(state.currentTime).toBe(30);
    key(LEFT);
    expect(state.currentTime).toBe(20);
    state.seekable = [[100, 200]];
    state.currentTime = 105;
    key(LEFT);
    expect(state.currentTime).toBe(100);
    state.currentTime = 195;
    key(RIGHT);
    expect(state.currentTime).toBe(200);
  });

  it('does not move without a seekable range', async () => {
    const { state } = await playing(stuck);
    state.duration = 5400;
    state.currentTime = 25;
    key(RIGHT);
    expect(state.currentTime).toBe(25);
  });

  it('a plan that can seek anywhere ignores the seekable ranges', async () => {
    const { state } = await playing();
    state.duration = 5400;
    state.seekable = [[0, 30]];
    state.currentTime = 25;
    key(RIGHT);
    expect(state.currentTime).toBe(35);
  });
});

describe('PlayerScreen diagnostics', () => {
  it('toggles with the blue key and shows the plan and the engine state', async () => {
    const { video, state } = await playing();
    state.videoWidth = 1920;
    state.videoHeight = 1080;
    state.currentTime = 65;
    state.bufferedEnd = 125;
    state.playbackRate = 1;
    state.readyState = 4;
    state.networkState = 2;
    expect(screen.queryByTestId('player-diagnostics')).not.toBeInTheDocument();
    key(BLUE);
    const overlay = await screen.findByTestId('player-diagnostics');
    fireEvent.timeUpdate(video);
    await waitFor(() => expect(overlay).toHaveTextContent('1920×1080'));
    expect(overlay).toHaveTextContent('original_http');
    expect(overlay).toHaveTextContent('mp4');
    expect(overlay).toHaveTextContent('h264');
    expect(overlay).toHaveTextContent('aac');
    expect(overlay).toHaveTextContent('1:05');
    expect(overlay).toHaveTextContent('2:05');
    expect(overlay).toHaveTextContent(SESSION_ID.slice(0, 8));
    expect(overlay.textContent).not.toContain(SESSION_ID);
    key(BLUE);
    expect(screen.queryByTestId('player-diagnostics')).not.toBeInTheDocument();
  });

  it('opens by itself on an error, and never shows the token or the media URL', async () => {
    const { video, state } = await playing();
    const src = video.getAttribute('src')!;
    state.error = { code: 3, message: `PIPELINE_ERROR_DECODE for ${src} (${ACCESS_TOKEN})` };
    fireEvent.error(video);
    const overlay = await screen.findByTestId('player-diagnostics');
    await waitFor(() => expect(overlay).toHaveTextContent('3 PIPELINE_ERROR_DECODE'));
    const shown = document.body.textContent ?? '';
    expect(shown).not.toContain(ACCESS_TOKEN);
    expect(shown).not.toContain('signed-1');
    expect(shown).not.toContain('/api/v2/stream/');
    expect(shown).not.toContain(src);
  });
});

describe('PlayerScreen failure', () => {
  it('replans once and loads the new plan; a second failure shows the error with Back', async () => {
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
    expect(calls.replan).toHaveLength(1);
    expect(currentVideo()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    // The list unmounts the player; that ends the session.
    view.unmount();
    await until(() => calls.stop.length === 1);
  });

  it('hides the token and its URL-encoded form on the error screen', async () => {
    const token = 'tok/en+x y';
    const { video, currentVideo } = await (async () => {
      const ctx = render({}, token);
      await screen.findByTestId('player');
      return { ...ctx, video: ctx.currentVideo()! };
    })();
    const message = `failed ${token} and ${encodeURIComponent(token)}`;
    fakeVideo(video).error = { code: 3, message };
    fireEvent.error(video);
    await waitFor(() => expect(currentVideo()).not.toBe(video));
    const second = currentVideo()!;
    fakeVideo(second).error = { code: 4, message };
    fireEvent.error(second);
    const error = await screen.findByTestId('player-error');
    await waitFor(() => expect(error).toHaveTextContent('[hidden]'));
    expect(error.textContent).not.toContain(token);
    expect(error.textContent).not.toContain(encodeURIComponent(token));
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
    ['a played title', watchUserData({ position_seconds: 90, played: true })],
  ])('is not shown for %s', async (_name, userData) => {
    const { calls } = render({ watch: watchDetail({ user_data: userData }) });
    await screen.findByTestId('player');
    expect(screen.queryByTestId('resume-prompt')).not.toBeInTheDocument();
    expect(calls.start[0]?.body.start_position).toBe(0);
  });

  it('Resume starts at the saved position', async () => {
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
