import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake, installFakeBridge } from '../../test/fakeBridge';
import { openYouTubeVideo } from './youtube';

const LAUNCH = 'luna://com.webos.applicationManager/launch';

afterEach(() => vi.unstubAllGlobals());

describe('openYouTubeVideo (webOS)', () => {
  it('launches the YouTube app with the video as the content target', async () => {
    installFakeBridge();
    fake.responders.set(LAUNCH, () => JSON.stringify({ returnValue: true }));
    await expect(openYouTubeVideo('dQw4w9WgXcQ')).resolves.toBe('opened');
    expect(fake.calls).toEqual([
      {
        uri: LAUNCH,
        params: {
          id: 'youtube.leanback.v4',
          params: { contentTarget: 'https://www.youtube.com/tv?v=dQw4w9WgXcQ' },
        },
      },
    ]);
  });

  it('answers unavailable when the launch fails', async () => {
    installFakeBridge();
    fake.responders.set(LAUNCH, () =>
      JSON.stringify({ returnValue: false, errorText: 'Application not found' }),
    );
    await expect(openYouTubeVideo('dQw4w9WgXcQ')).resolves.toBe('unavailable');
  });

  it('answers unavailable without a Luna bridge', async () => {
    await expect(openYouTubeVideo('dQw4w9WgXcQ')).resolves.toBe('unavailable');
  });

  it('never calls Luna for an id that is not a plain video id', async () => {
    installFakeBridge();
    fake.responders.set(LAUNCH, () => JSON.stringify({ returnValue: true }));
    for (const bad of [
      '',
      'short',
      'has space!!',
      'a/b/c/d/e/f',
      'x'.repeat(21),
      'abc&list=zzzz',
    ]) {
      await expect(openYouTubeVideo(bad)).resolves.toBe('unavailable');
    }
    expect(fake.calls).toHaveLength(0);
  });
});
