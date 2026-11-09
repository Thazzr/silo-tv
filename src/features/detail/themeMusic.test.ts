import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptedFormats,
  firstTheme,
  resolveGrantUrl,
  THEME_VOLUME,
  ThemeMusicController,
  type ThemeGrant,
} from './themeMusic';
import { FakeAudio } from '../../test/fakeAudio';

describe('acceptedFormats', () => {
  it('lists only the candidates the element can play, with their exact container and codec', () => {
    const playable = new Set(['audio/mpeg', 'audio/flac', 'audio/ogg; codecs="opus"']);
    expect(acceptedFormats((mime) => (playable.has(mime) ? 'probably' : ''))).toEqual([
      { container: 'mp3', audio_codec: 'mp3' },
      { container: 'flac', audio_codec: 'flac' },
      { container: 'ogg', audio_codec: 'opus' },
    ]);
  });

  it('lists all seven pairs when everything plays, and none when nothing does', () => {
    expect(acceptedFormats(() => 'maybe')).toEqual([
      { container: 'mp3', audio_codec: 'mp3' },
      { container: 'mp4', audio_codec: 'aac' },
      { container: 'm4a', audio_codec: 'aac' },
      { container: 'aac', audio_codec: 'aac' },
      { container: 'flac', audio_codec: 'flac' },
      { container: 'ogg', audio_codec: 'vorbis' },
      { container: 'ogg', audio_codec: 'opus' },
    ]);
    expect(acceptedFormats(() => '')).toEqual([]);
  });

  it('asks the element about the AAC candidates with the AAC-LC codec string', () => {
    const asked: string[] = [];
    acceptedFormats((mime) => {
      asked.push(mime);
      return '';
    });
    expect(asked).toContain('audio/mp4; codecs="mp4a.40.2"');
    expect(asked).toContain('audio/aac');
  });
});

describe('resolveGrantUrl', () => {
  it('resolves a relative grant against the server base URL', () => {
    expect(resolveGrantUrl('/api/v2/media/theme/abc', 'https://silo.test')).toBe(
      'https://silo.test/api/v2/media/theme/abc',
    );
  });

  it('keeps an absolute proxy URL exactly as it is', () => {
    const url = 'https://node-2.example.test:8443/t/abc?sig=xyz';
    expect(resolveGrantUrl(url, 'https://silo.test')).toBe(url);
  });

  it('never adds a token or any other parameter', () => {
    expect(resolveGrantUrl('/t/abc?sig=1', 'https://silo.test')).not.toContain('token');
    expect(resolveGrantUrl('/t/abc', 'https://silo.test')).toBe('https://silo.test/t/abc');
  });
});

describe('firstTheme', () => {
  const song = (id: string) => ({ id, title: id, duration_seconds: 10, container: 'mp3' });
  it('takes the first song with a numeric id, under the set owner', () => {
    expect(
      firstTheme({ owner_id: '7', items: [song('x1'), song('0'), song('12'), song('3')] }),
    ).toEqual({ ownerId: '7', themeId: '12' });
  });
  it('has none for no set, an empty set, or only unusable ids', () => {
    expect(firstTheme(undefined)).toBeNull();
    expect(firstTheme({ owner_id: '7', items: [] })).toBeNull();
    expect(firstTheme({ owner_id: '7', items: [song('abc'), song('01')] })).toBeNull();
  });
});

const original: ThemeGrant = { url: 'https://silo.test/t/1', delivery: 'original' };
const converted: ThemeGrant = { url: 'https://silo.test/t/2', delivery: 'converted' };

/** Lets promise continuations run (grant resolution, play()). */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('ThemeMusicController', () => {
  let audios: FakeAudio[];
  const audio = (index: number): FakeAudio => {
    const found = audios[index];
    if (!found) throw new Error(`no audio element ${index}`);
    return found;
  };
  let controller: ThemeMusicController;
  // What the next created element's play() answers.
  let nextPlay: Promise<void> | null;
  beforeEach(() => {
    vi.useFakeTimers();
    audios = [];
    nextPlay = null;
    controller = new ThemeMusicController({
      createAudio: () => {
        const audio = new FakeAudio();
        if (nextPlay) audio.playResult = nextPlay;
        audios.push(audio);
        return audio;
      },
      setTimer: (callback, ms) => setInterval(callback, ms),
      clearTimer: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    });
  });
  afterEach(() => vi.useRealTimers());

  const grants = (...answers: (ThemeGrant | 'refuse')[]) => {
    const request = vi.fn(() => {
      const answer = answers.shift() ?? 'refuse';
      return answer === 'refuse' ? Promise.reject(new Error('refused')) : Promise.resolve(answer);
    });
    return request;
  };

  it('starts at volume 0, fades in to 0.35 in steps and never goes above it', async () => {
    controller.start(grants(original), () => false);
    await settle();
    expect(audios).toHaveLength(1);
    expect(audio(0).src).toBe(original.url);
    expect(audio(0).volume).toBe(0);
    expect(audio(0).played).toBe(1);
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      vi.advanceTimersByTime(100);
      seen.push(audio(0).volume);
    }
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(THEME_VOLUME);
    expect(Math.max(...seen)).toBeCloseTo(0.35, 10);
    expect(seen.every((volume) => volume <= THEME_VOLUME)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('loops an original in place and does not ask for a new grant', async () => {
    const request = grants(original);
    controller.start(request, () => true);
    await settle();
    expect(audio(0).loop).toBe(true);
    audio(0).fire('ended');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not loop in place without the loop setting', async () => {
    controller.start(grants(original), () => false);
    await settle();
    expect(audio(0).loop).toBe(false);
  });

  it('replays a converted theme with a new grant when it ends and loop is on', async () => {
    const request = grants(converted, converted);
    controller.start(request, () => true);
    await settle();
    expect(audio(0).loop).toBe(false);
    audio(0).fire('ended');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(audios).toHaveLength(2);
    expect(audio(0).paused).toBe(true);
    expect(audio(1).volume).toBe(0);
    expect(audio(1).played).toBe(1);
  });

  it('stays silent after the end without loop: no new grant, no new element', async () => {
    const request = grants(original, original);
    controller.start(request, () => false);
    await settle();
    audio(0).fire('ended');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(audios).toHaveLength(1);
  });

  it('retries a failing stream exactly once with a new grant, then stays silent', async () => {
    const request = grants(original, original, original);
    controller.start(request, () => false);
    await settle();
    audio(0).fire('error');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(audios).toHaveLength(2);
    expect(audio(0).src).toBe('');
    audio(1).fire('error');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(audios).toHaveLength(2);
    expect(audio(1).paused).toBe(true);
    expect(audio(1).src).toBe('');
  });

  it('stays silent on a refused grant and does not retry', async () => {
    const request = grants('refuse', original);
    controller.start(request, () => false);
    await settle();
    vi.advanceTimersByTime(5000);
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(audios).toHaveLength(0);
  });

  it('stays silent when play() is rejected, without retrying', async () => {
    const request = grants(original, original);
    const rejecting = Promise.reject(new Error('NotAllowedError'));
    rejecting.catch(() => undefined);
    nextPlay = rejecting;
    controller.start(request, () => false);
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(audio(0).paused).toBe(true);
    expect(audio(0).src).toBe('');
  });

  it('stops at once: pauses, removes the source and calls load()', async () => {
    controller.start(grants(original), () => false);
    await settle();
    vi.advanceTimersByTime(300);
    controller.stop();
    expect(audio(0).paused).toBe(true);
    expect(audio(0).src).toBe('');
    expect(audio(0).loads).toBe(1);
    // The fade is over: the volume does not move any more.
    const volume = audio(0).volume;
    vi.advanceTimersByTime(2000);
    expect(audio(0).volume).toBe(volume);
  });

  it('drops a grant that resolves after stop', async () => {
    let resolve!: (grant: ThemeGrant) => void;
    const request = vi.fn(() => new Promise<ThemeGrant>((r) => (resolve = r)));
    controller.start(request, () => false);
    controller.stop();
    resolve(original);
    await settle();
    expect(audios).toHaveLength(0);
  });

  it('drops a play() that resolves after stop: no fade, no volume', async () => {
    let finish!: () => void;
    nextPlay = new Promise<void>((r) => (finish = r));
    controller.start(grants(original), () => false);
    await settle();
    controller.stop();
    finish();
    await settle();
    vi.advanceTimersByTime(2000);
    expect(audio(0).volume).toBe(0);
  });

  it('a new start stops the previous element', async () => {
    controller.start(grants(original), () => false);
    await settle();
    controller.start(grants(converted), () => false);
    await settle();
    expect(audios).toHaveLength(2);
    expect(audio(0).paused).toBe(true);
    expect(audio(0).src).toBe('');
    expect(audio(1).src).toBe(converted.url);
  });

  it('a start that is replaced cannot stop its successor', async () => {
    const stopFirst = controller.start(grants(original), () => false);
    await settle();
    controller.start(grants(converted), () => false);
    await settle();
    stopFirst();
    expect(audio(1).paused).toBe(false);
    expect(audio(1).src).toBe(converted.url);
  });
});
