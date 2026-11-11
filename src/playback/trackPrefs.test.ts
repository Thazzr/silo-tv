import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import {
  audioPreferenceBody,
  createTrackPrefWriter,
  SAVE_RETRY_MS,
  subtitlePreferenceBody,
  trackPrefKey,
} from './trackPrefs';

type S = components['schemas'];

afterEach(() => vi.useRealTimers());

const inventoryItem = (overrides: Partial<S['SubtitleInventoryItemV3']> = {}) => ({
  track_id: 'sub:3',
  combined_index: 3,
  source: 'embedded',
  forced: false,
  default: false,
  hearing_impaired: true,
  delivery: 'sidecar',
  language: 'de',
  codec: 'subrip',
  label: 'German (SDH)',
  ...overrides,
});

interface Call {
  path: string;
  params: { path: { series_id: string }; header: { 'X-Profile-Id': string } };
  body: unknown;
}

/** A client whose PUT records the call and answers from `answers` (the last one repeats). */
function fakeClient(answers: boolean[] = [true]) {
  const calls: Call[] = [];
  const put = vi.fn(async (path: string, init: Omit<Call, 'path'>) => {
    calls.push({ path, ...init });
    const ok = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return { response: { ok } as Response, data: undefined, error: undefined };
  });
  return { client: { PUT: put } as unknown as Pick<SiloClient, 'PUT'>, calls };
}

describe('trackPrefKey', () => {
  it("is the episode's series, else the movie itself", () => {
    expect(trackPrefKey({ isEpisode: true, seriesId: 's1' }, 'e1')).toBe('s1');
    expect(trackPrefKey({ isEpisode: false }, 'm1')).toBe('m1');
  });

  it('is undefined for an episode that names no series', () => {
    expect(trackPrefKey({ isEpisode: true }, 'e1')).toBeUndefined();
  });
});

describe('audioPreferenceBody', () => {
  it("carries the track's ordinal, its language and the catalog's own signature fields", () => {
    expect(
      audioPreferenceBody(2, {
        default: true,
        language: ' de ',
        title: 'German 5.1',
        embedded_title: 'Surround',
        codec: 'eac3',
        layout: '5.1',
        channels: 6,
      }),
    ).toEqual({
      audio_track_index: 2,
      audio_language: 'de',
      // `default` says nothing about what the viewer wants and stays out.
      track_signature: {
        language: 'de',
        title: 'German 5.1',
        embedded_title: 'Surround',
        codec: 'eac3',
        layout: '5.1',
        channels: 6,
      },
    });
  });

  it('saves no language for a code that names none, and leaves out empty signature fields', () => {
    const body = audioPreferenceBody(0, {
      default: false,
      language: 'und',
      codec: 'aac',
      title: ' ',
    });
    expect(body).toEqual({
      audio_track_index: 0,
      track_signature: { language: 'und', codec: 'aac' },
    });
    expect('audio_language' in body).toBe(false);
  });

  it('sends no signature for a track that has nothing to match on', () => {
    expect(audioPreferenceBody(1, { default: false })).toEqual({ audio_track_index: 1 });
  });
});

describe('subtitlePreferenceBody', () => {
  it('saves a track as mode always with its index, language and signature', () => {
    expect(subtitlePreferenceBody(inventoryItem())).toEqual({
      subtitle_track_index: 3,
      subtitle_mode: 'always',
      subtitle_language: 'de',
      track_signature: {
        source: 'embedded',
        language: 'de',
        codec: 'subrip',
        label: 'German (SDH)',
        forced: false,
        hearing_impaired: true,
      },
    });
  });

  it('saves an empty language for a track that names none', () => {
    expect(subtitlePreferenceBody(inventoryItem({ language: undefined })).subtitle_language).toBe(
      '',
    );
  });

  it('saves Off as mode off, index -1 and no language', () => {
    expect(subtitlePreferenceBody(null)).toEqual({
      subtitle_track_index: -1,
      subtitle_mode: 'off',
      subtitle_language: '',
    });
  });
});

describe('createTrackPrefWriter', () => {
  it('puts an audio pick under the key with the profile header', async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => 'p1');
    await writer.audio('series-1', 1, { default: false, language: 'en' });
    expect(calls).toEqual([
      {
        path: '/api/v2/audio-prefs/{series_id}',
        params: { path: { series_id: 'series-1' }, header: { 'X-Profile-Id': 'p1' } },
        body: { audio_track_index: 1, audio_language: 'en', track_signature: { language: 'en' } },
      },
    ]);
  });

  it('puts a subtitle pick, and Off, under the key', async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => 'p1');
    await writer.subtitle('movie-1', inventoryItem());
    await writer.subtitle('movie-1', null);
    expect(calls.map((call) => [call.path, call.params.path.series_id])).toEqual([
      ['/api/v2/subtitle-prefs/{series_id}', 'movie-1'],
      ['/api/v2/subtitle-prefs/{series_id}', 'movie-1'],
    ]);
    expect(calls.map((call) => (call.body as { subtitle_mode: string }).subtitle_mode)).toEqual([
      'always',
      'off',
    ]);
  });

  it('retries a failed save once after 2 s, and no more', async () => {
    vi.useFakeTimers();
    const { client, calls } = fakeClient([false]);
    const writer = createTrackPrefWriter(client, () => 'p1');
    const settled = writer.audio('s1', 0, { default: false, language: 'en' });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    expect(SAVE_RETRY_MS).toBe(2000);
  });

  it('does not retry a save that went through, and retries one the network dropped', async () => {
    vi.useFakeTimers();
    const ok = fakeClient([true]);
    await createTrackPrefWriter(ok.client, () => 'p1').audio('s1', 0, { default: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ok.calls).toHaveLength(1);

    const calls: number[] = [];
    const failing = {
      PUT: vi.fn(async () => {
        calls.push(calls.length);
        if (calls.length === 1) throw new TypeError('offline');
        return { response: { ok: true } as Response };
      }),
    } as unknown as Pick<SiloClient, 'PUT'>;
    const settled = createTrackPrefWriter(failing, () => 'p1').audio('s1', 0, { default: false });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    await expect(settled).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('sends the saves of one key one after another, in the order they were made', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const client = {
      PUT: vi.fn(async (_path: string, init: { body: { audio_track_index: number } }) => {
        order.push(`start ${init.body.audio_track_index}`);
        if (init.body.audio_track_index === 0) await gate;
        order.push(`end ${init.body.audio_track_index}`);
        return { response: { ok: true } as Response };
      }),
    } as unknown as Pick<SiloClient, 'PUT'>;
    const writer = createTrackPrefWriter(client, () => 'p1');
    const first = writer.audio('s1', 0, { default: false });
    const second = writer.audio('s1', 1, { default: false });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(['start 0']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start 0', 'end 0', 'start 1', 'end 1']);
  });

  describe('the order of saves', () => {
    /** A client whose first PUT waits on a gate; the rest answer at once. Records start order. */
    function gatedClient() {
      const starts: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const client = {
        PUT: vi.fn(
          async (
            path: string,
            init: { params: { path: { series_id: string }; header: { 'X-Profile-Id': string } } },
          ) => {
            const label = `${init.params.header['X-Profile-Id']} ${path.split('/')[3]} ${init.params.path.series_id}`;
            starts.push(label);
            if (starts.length === 1) await gate;
            return { response: { ok: true } as Response };
          },
        ),
      } as unknown as Pick<SiloClient, 'PUT'>;
      return { client, starts, release };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    const track = { default: false };

    it('lets a save for another kind, another title or another profile go ahead', async () => {
      const { client, starts, release } = gatedClient();
      let profile = 'p1';
      const writer = createTrackPrefWriter(client, () => profile);
      const held = writer.audio('s1', 0, track);
      const kind = writer.subtitle('s1', null);
      const title = writer.audio('s2', 0, track);
      profile = 'p2';
      const other = writer.audio('s1', 0, track);
      await Promise.all([kind, title, other]);
      expect(starts).toEqual([
        'p1 audio-prefs s1',
        'p1 subtitle-prefs s1',
        'p1 audio-prefs s2',
        'p2 audio-prefs s1',
      ]);
      release();
      await held;
    });

    it('lets a subtitle save for another title or profile go ahead of a held one', async () => {
      const { client, starts, release } = gatedClient();
      let profile = 'p1';
      const writer = createTrackPrefWriter(client, () => profile);
      const held = writer.subtitle('s1', null);
      const title = writer.subtitle('s2', null);
      profile = 'p2';
      const other = writer.subtitle('s1', null);
      await Promise.all([title, other]);
      expect(starts).toEqual([
        'p1 subtitle-prefs s1',
        'p1 subtitle-prefs s2',
        'p2 subtitle-prefs s1',
      ]);
      release();
      await held;
    });

    it('holds a second save for the same kind, title and profile until the first is done', async () => {
      const { client, starts, release } = gatedClient();
      const writer = createTrackPrefWriter(client, () => 'p1');
      const first = writer.audio('s1', 0, track);
      const second = writer.audio('s1', 1, track);
      await settle();
      expect(starts).toHaveLength(1);
      release();
      await Promise.all([first, second]);
      expect(starts).toHaveLength(2);
    });
  });

  it('saves nothing without a profile', async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => '');
    await writer.audio('s1', 0, { default: false });
    await writer.subtitle('s1', null);
    expect(calls).toHaveLength(0);
  });
});
