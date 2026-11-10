import { cleanup, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../api/session';
import { account } from '../test/apiFixtures';
import { installFakeMedia } from '../test/fakeVideo';
import {
  ACCESS_TOKEN,
  playableDecision,
  playbackPlan,
  servePlayback,
} from '../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../test/renderFlow';
import { serveSettings } from '../test/settingsFixtures';
import { HtmlVideoEngine } from './engine/HtmlVideoEngine';
import { PlayerScreen } from './PlayerScreen';
import { clearInstallationCache } from './session/startSession';

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
  vi.restoreAllMocks();
});

/** Plays a plan and returns the options the screen gave the engine with the source. */
async function sourceOptionsFor(stream: Partial<ReturnType<typeof playbackPlan>['stream']>) {
  const setSource = vi.spyOn(HtmlVideoEngine.prototype, 'setSource').mockImplementation(() => {});
  const base = playbackPlan();
  servePlayback(server, {
    start: [playableDecision(playbackPlan({ stream: { ...base.stream, ...stream } }))],
  });
  serveSettings(server, {});
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  renderWithSilo(<PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} />, {
    session,
  });
  await screen.findByTestId('player');
  expect(setSource).toHaveBeenCalledTimes(1);
  return setSource.mock.calls[0]![1];
}

describe('PlayerScreen tells the engine whether the source is HLS', () => {
  it('flags a plan with protocol hls', async () => {
    expect(await sourceOptionsFor({ protocol: 'hls', url: '/api/v2/stream/x?st=1' })).toEqual({
      hls: true,
    });
  });

  it('does not flag a progressive plan', async () => {
    expect(await sourceOptionsFor({ protocol: 'http', mime_type: 'video/mp4' })).toEqual({
      hls: false,
    });
  });

  it('flags an HLS MIME type on a URL that does not end in .m3u8', async () => {
    expect(
      await sourceOptionsFor({
        protocol: 'http',
        mime_type: 'application/vnd.apple.mpegurl',
        url: '/api/v2/stream/x/playlist?st=1',
      }),
    ).toEqual({ hls: true });
  });
});
