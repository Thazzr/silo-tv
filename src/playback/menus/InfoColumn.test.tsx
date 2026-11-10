// The info column on its own: its readings follow the video element and stop with the column.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import { playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts } from '../usePlaybackSession';
import { InfoColumn } from './InfoColumn';

const media: MediaFacts = {
  fileId: 'file-1',
  isEpisode: false,
  hdr: false,
  audioTracks: [],
  subtitleTracks: [],
};

let restoreMedia: () => void;
beforeEach(() => {
  restoreMedia = installFakeMedia();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreMedia();
});

function videoOfSize(width: number, height: number): HTMLVideoElement {
  const video = document.createElement('video');
  const state = fakeVideo(video);
  state.videoWidth = width;
  state.videoHeight = height;
  return video;
}

const column = (video: HTMLVideoElement | null) => (
  <I18nProvider lang="en">
    <InfoColumn plan={playbackPlan()} media={media} video={video} />
  </I18nProvider>
);

describe('the info column', () => {
  it('shows the new video element at once when the element changes, not a second later', () => {
    const { rerender } = render(column(videoOfSize(1920, 1080)));
    expect(screen.getByTestId('player-info')).toHaveTextContent('1920×1080');
    rerender(column(videoOfSize(1280, 720)));
    expect(screen.getByTestId('player-info')).toHaveTextContent('1280×720');
    expect(screen.getByTestId('player-info')).not.toHaveTextContent('1920×1080');
  });

  it('refreshes once a second while it is open, and leaves no timer behind after it closes', () => {
    const video = videoOfSize(0, 0);
    const { unmount } = render(column(video));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    // The size becomes known later: the next second shows it.
    const state = fakeVideo(video);
    state.videoWidth = 3840;
    state.videoHeight = 2160;
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('player-info')).toHaveTextContent('3840×2160');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
