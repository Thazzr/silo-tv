import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import {
  audioPreferenceBody,
  createTrackPrefWriter,
  SAVE_RETRY_MS,
  subtitlePreferenceBody,
  subtitleSeriesSettings,
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
  params: {
    path: { series_id?: string; key?: string };
    query?: { scope: string; series_id: string };
  };
  body: unknown;
}

/**
 * A client whose PUT records the call and answers from `answers` (the last one repeats); its DELETE
 * records into `deleted` and answers with `status` for the settings rows and 204 for the rest.
 */
function fakeClient(answers: boolean[] = [true], status = 204, prefsStatus = 204) {
  const calls: Call[] = [];
  const deleted: Omit<Call, 'body'>[] = [];
  const put = vi.fn(async (path: string, init: Omit<Call, 'path'>) => {
    calls.push({ path, ...init });
    const ok = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return { response: { ok } as Response, data: undefined, error: undefined };
  });
  const del = vi.fn(async (path: string, init: Omit<Call, 'path' | 'body'>) => {
    deleted.push({ path, ...init });
    const answer = path.includes('settings') ? status : prefsStatus;
    return { response: { ok: answer < 300, status: answer } as Response };
  });
  return {
    client: { PUT: put, DELETE: del } as unknown as Pick<SiloClient, 'PUT' | 'DELETE'>,
    calls,
    deleted,
  };
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

describe('subtitleSeriesSettings', () => {
  it("is the track's language and mode always, or null and off", () => {
    expect(subtitleSeriesSettings(inventoryItem())).toEqual([
      { key: 'playback.subtitle_language', value: 'de' },
      { key: 'playback.subtitle_mode', value: 'always' },
    ]);
    expect(subtitleSeriesSettings(null)).toEqual([
      { key: 'playback.subtitle_language', value: null },
      { key: 'playback.subtitle_mode', value: 'off' },
    ]);
  });

  it('stores no language for a track that has none: null, not an empty string', () => {
    expect(subtitleSeriesSettings(inventoryItem({ language: undefined }))[0]?.value).toBeNull();
    expect(subtitleSeriesSettings(inventoryItem({ language: '' }))[0]?.value).toBeNull();
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
  it('puts an audio pick under the key', async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => 'p1');
    await writer.audio('series-1', 1, { default: false, language: 'en' });
    expect(calls).toEqual([
      {
        path: '/api/v2/audio-prefs/{series_id}',
        params: { path: { series_id: 'series-1' } },
        body: { audio_track_index: 1, audio_language: 'en', track_signature: { language: 'en' } },
      },
    ]);
  });

  it('puts a subtitle pick, and Off, under the key', async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => 'p1');
    await writer.subtitle('movie-1', inventoryItem());
    await writer.subtitle('movie-1', null);
    const rows = calls.filter((call) => call.path === '/api/v2/subtitle-prefs/{series_id}');
    expect(rows.map((call) => call.params.path.series_id)).toEqual(['movie-1', 'movie-1']);
    expect(rows.map((call) => (call.body as { subtitle_mode: string }).subtitle_mode)).toEqual([
      'always',
      'off',
    ]);
  });

  it("writes a subtitle pick as the web client does: the series settings rows, then the track's", async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => 'p1');
    await writer.subtitle('series-1', inventoryItem());
    const settings = (key: string, value: unknown) => ({
      path: '/api/v2/settings/values/{key}',
      params: {
        path: { key },
        query: { scope: 'profile_series', series_id: 'series-1' },
      },
      body: { value },
    });
    expect(calls).toEqual([
      settings('playback.subtitle_language', 'de'),
      settings('playback.subtitle_mode', 'always'),
      {
        path: '/api/v2/subtitle-prefs/{series_id}',
        params: { path: { series_id: 'series-1' } },
        body: subtitlePreferenceBody(inventoryItem()),
      },
    ]);
  });

  it('writes Off as mode off with no language, and never the forced-subtitles setting', async () => {
    const { client, calls } = fakeClient();
    await createTrackPrefWriter(client, () => 'p1').subtitle('series-1', null);
    const rows = calls.filter((call) => call.path === '/api/v2/settings/values/{key}');
    expect(
      rows.map((call) => [call.params.path.key, (call.body as { value: unknown }).value]),
    ).toEqual([
      ['playback.subtitle_language', null],
      ['playback.subtitle_mode', 'off'],
    ]);
    expect(JSON.stringify(calls)).not.toContain('show_forced');
  });

  it('does not write the settings rows for an audio pick', async () => {
    const { client, calls } = fakeClient();
    await createTrackPrefWriter(client, () => 'p1').audio('s1', 0, { default: false });
    expect(calls.map((call) => call.path)).toEqual(['/api/v2/audio-prefs/{series_id}']);
  });

  it('sends every subtitle write again after a failed one, once, so no row is lost', async () => {
    vi.useFakeTimers();
    // The first write (the language row) fails; the track row of the same save goes through.
    const { client, calls } = fakeClient([false, true]);
    const settled = createTrackPrefWriter(client, () => 'p1').subtitle('s1', inventoryItem());
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    await settled;
    expect(calls.map((call) => call.path)).toEqual([
      '/api/v2/settings/values/{key}',
      '/api/v2/settings/values/{key}',
      '/api/v2/subtitle-prefs/{series_id}',
      '/api/v2/settings/values/{key}',
      '/api/v2/settings/values/{key}',
      '/api/v2/subtitle-prefs/{series_id}',
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
    } as unknown as Pick<SiloClient, 'PUT' | 'DELETE'>;
    const settled = createTrackPrefWriter(failing, () => 'p1').audio('s1', 0, { default: false });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    await expect(settled).resolves.toBe(true);
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
    } as unknown as Pick<SiloClient, 'PUT' | 'DELETE'>;
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
            init: {
              params: {
                path: { series_id?: string };
                query?: { series_id: string };
              };
            },
          ) => {
            const title = init.params.path.series_id ?? init.params.query?.series_id;
            const label = `${path.split('/')[3]} ${title}`;
            starts.push(label);
            if (starts.length === 1) await gate;
            return { response: { ok: true } as Response };
          },
        ),
      } as unknown as Pick<SiloClient, 'PUT' | 'DELETE'>;
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
        'audio-prefs s1',
        'settings s1',
        'settings s1',
        'subtitle-prefs s1',
        'audio-prefs s2',
        'audio-prefs s1',
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
      // A subtitle save is its two settings rows and the track row, all sent at once.
      expect(starts).toEqual([
        'settings s1',
        'settings s1',
        'subtitle-prefs s1',
        'settings s2',
        'settings s2',
        'subtitle-prefs s2',
        'settings s1',
        'settings s1',
        'subtitle-prefs s1',
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

  it('saves nothing without a profile, and says so', async () => {
    const { client, calls } = fakeClient();
    const writer = createTrackPrefWriter(client, () => '');
    await expect(writer.audio('s1', 0, { default: false })).resolves.toBe(false);
    await expect(writer.subtitle('s1', null)).resolves.toBe(false);
    await expect(writer.resetAudio('s1')).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('says whether the server kept a save: yes at once, yes on the retry, no after it', async () => {
    vi.useFakeTimers();
    const first = createTrackPrefWriter(fakeClient([true]).client, () => 'p1');
    await expect(first.audio('s1', 0, { default: false })).resolves.toBe(true);
    const retried = createTrackPrefWriter(fakeClient([false, true]).client, () => 'p1');
    const second = retried.audio('s1', 0, { default: false });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    await expect(second).resolves.toBe(true);
    const dropped = createTrackPrefWriter(fakeClient([false]).client, () => 'p1');
    const third = dropped.audio('s1', 0, { default: false });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    await expect(third).resolves.toBe(false);
  });

  describe('forgetting a pick', () => {
    it('deletes the remembered audio track under the key', async () => {
      const { client, calls, deleted } = fakeClient();
      await expect(createTrackPrefWriter(client, () => 'p1').resetAudio('s1')).resolves.toBe(true);
      expect(deleted).toEqual([
        { path: '/api/v2/audio-prefs/{series_id}', params: { path: { series_id: 's1' } } },
      ]);
      expect(calls).toHaveLength(0);
    });

    it('deletes the remembered subtitle and the series settings rows that went with it', async () => {
      const { client, deleted } = fakeClient();
      await expect(
        createTrackPrefWriter(client, () => 'p1').resetSubtitle('series-1'),
      ).resolves.toBe(true);
      const row = (key: string) => ({
        path: '/api/v2/settings/values/{key}',
        params: { path: { key }, query: { scope: 'profile_series', series_id: 'series-1' } },
      });
      expect(deleted).toEqual([
        row('playback.subtitle_language'),
        row('playback.subtitle_mode'),
        { path: '/api/v2/subtitle-prefs/{series_id}', params: { path: { series_id: 'series-1' } } },
      ]);
    });

    it('counts a settings row that was never stored as forgotten', async () => {
      const { client } = fakeClient([true], 404);
      await expect(createTrackPrefWriter(client, () => 'p1').resetSubtitle('s1')).resolves.toBe(
        true,
      );
    });

    it('retries a failed settings row once, then reports that it was not forgotten', async () => {
      vi.useFakeTimers();
      const { client, deleted } = fakeClient([true], 500);
      const settled = createTrackPrefWriter(client, () => 'p1').resetSubtitle('s1');
      await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
      await expect(settled).resolves.toBe(false);
      expect(deleted).toHaveLength(6);
    });

    it('reports a failed delete of the remembered subtitle, whatever the settings rows did', async () => {
      vi.useFakeTimers();
      const { client } = fakeClient([true], 204, 500);
      const settled = createTrackPrefWriter(client, () => 'p1').resetSubtitle('s1');
      await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
      await expect(settled).resolves.toBe(false);
    });

    it('reports a failed delete of the remembered audio track', async () => {
      vi.useFakeTimers();
      const { client, deleted } = fakeClient([true], 204, 500);
      const settled = createTrackPrefWriter(client, () => 'p1').resetAudio('s1');
      await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
      await expect(settled).resolves.toBe(false);
      expect(deleted).toHaveLength(2);
    });

    it('goes after the pick made before it, so the last choice is the one kept', async () => {
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const client = {
        PUT: vi.fn(async () => {
          order.push('put');
          await gate;
          return { response: { ok: true } as Response };
        }),
        DELETE: vi.fn(async () => {
          order.push('delete');
          return { response: { ok: true } as Response };
        }),
      } as unknown as Pick<SiloClient, 'PUT' | 'DELETE'>;
      const writer = createTrackPrefWriter(client, () => 'p1');
      const pick = writer.audio('s1', 1, { default: false });
      const reset = writer.resetAudio('s1');
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(order).toEqual(['put']);
      release();
      await Promise.all([pick, reset]);
      expect(order).toEqual(['put', 'delete']);
    });
  });
});
