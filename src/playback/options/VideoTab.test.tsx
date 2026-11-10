// The Video tab on its own: the in-flight guard of a quality pick, and the rows' focus keys.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { ACCESS_TOKEN } from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import type { ReplanResult } from '../usePlaybackSession';
import { AUTO, type QualityMenu } from './qualityMenu';
import { AUTO_PLAY_KEY, QUALITY_KEY_PREFIX, VideoTab, videoRowKeys } from './VideoTab';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const MENU: QualityMenu = {
  rows: [
    { label: '1080p', name: '1080p' },
    { label: '720p', name: '720p' },
  ],
  checked: AUTO,
  unmatched: null,
};

describe('videoRowKeys', () => {
  it('lists Auto, the rows and, for an episode, the auto-play switch', () => {
    expect(videoRowKeys(MENU, true)).toEqual([
      `${QUALITY_KEY_PREFIX}auto`,
      `${QUALITY_KEY_PREFIX}1080p`,
      `${QUALITY_KEY_PREFIX}720p`,
      AUTO_PLAY_KEY,
    ]);
  });

  it('has no auto-play key for a movie, and no keys at all without a choice', () => {
    expect(videoRowKeys(MENU, false)).not.toContain(AUTO_PLAY_KEY);
    expect(videoRowKeys(null, false)).toEqual([]);
    expect(videoRowKeys(null, true)).toEqual([AUTO_PLAY_KEY]);
  });
});

describe('a quality pick', () => {
  it('asks for one replan while another is in flight, and again once it is answered', async () => {
    serveSettings(server);
    const session = new Session(memoryStorage());
    session.set({
      accessToken: ACCESS_TOKEN,
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    let answer!: (result: ReplanResult) => void;
    const qualityChange = vi.fn(
      () => new Promise<ReplanResult>((resolve) => void (answer = resolve)),
    );
    renderWithSilo(
      <VideoTab
        menu={MENU}
        preference="auto"
        episode={false}
        qualityChange={qualityChange}
        onFocusKey={() => {}}
      />,
      { session },
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: '1080p' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '720p' }));
    expect(qualityChange).toHaveBeenCalledTimes(1);
    expect(qualityChange).toHaveBeenCalledWith('1080p');
    answer({ kind: 'applied' });
    await vi.waitFor(() => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: '720p' }));
      expect(qualityChange).toHaveBeenCalledTimes(2);
    });
  });
});
