// A slow start: with evidence of a slow link (hls.js measures less than the plan delivers) the
// prompt is offered before the first frame, and the screen keeps it hidden until a frame plays.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackPlan,
  servePlayback,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../session/startSession';

// jsdom has no MSE: hls.js is a stand-in that reports a measured bandwidth of 2 Mbit/s.
vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = () => true;
    static Events = { ERROR: 'hlsError', FRAG_LOADED: 'hlsFragLoaded' };
    static ErrorTypes = { NETWORK_ERROR: 'n', MEDIA_ERROR: 'm', OTHER_ERROR: 'o' };
    bandwidthEstimate = 2_000_000;
    attachMedia = vi.fn();
    loadSource = vi.fn();
    detachMedia = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
  }
  return { default: FakeHls };
});

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
  vi.useRealTimers();
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('a slow start with evidence', () => {
  it('offers the prompt before the first frame, and shows it only once a frame has played', async () => {
    servePlayback(server, {
      start: [
        playableDecision(
          playbackPlan({
            effective_recipe: { video_codec: 'h264', audio_codec: 'aac', bitrate_kbps: 10_000 },
            stream: {
              container: 'ts',
              header_refresh: 'none',
              headers: {},
              protocol: 'hls',
              url: `/api/v2/stream/${SESSION_ID}/index.m3u8`,
            },
          }),
        ),
      ],
    });
    serveSettings(server, { values: { 'playback.buffering_quality_mode': 'ask' } });
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
      { session },
    );
    await screen.findByTestId('player');
    const video = view.container.querySelector('video')!;
    fireEvent.loadedMetadata(video);
    // Autoplay is on: the element is not paused while it waits for its first frame.
    fakeVideo(video).paused = false;
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    // 17 s of waiting for the first frame, with data arriving: grace (10 s) plus 6 s.
    fireEvent(video, new Event('waiting'));
    for (let second = 0; second < 17; second += 1) {
      fireEvent(video, new Event('progress'));
      advance(1000);
    }
    expect(screen.queryByTestId('player-buffering')).toBeNull();
    fireEvent.playing(video);
    expect(screen.getByTestId('player-buffering')).toBeInTheDocument();
  });
});
