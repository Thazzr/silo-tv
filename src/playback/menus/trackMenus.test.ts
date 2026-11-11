import { describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts, S } from '../session/types';
import {
  audioChannelsBadge,
  audioIdentity,
  audioRows,
  groupThousands,
  subtitleFormat,
  subtitleRows,
  tracksForAudioPick,
  tracksForSubtitlePick,
  type InventoryItem,
  type TrackText,
} from './trackMenus';

const text = (overrides: Partial<TrackText> = {}): TrackText => ({
  unknown: (n) => `Track ${n}`,
  audio: 'Audio',
  stereo: 'Stereo',
  bitDepth: (depth) => `${depth}-bit`,
  ...overrides,
});

const audio = (overrides: Partial<S['WatchAudioTrack']> = {}): S['WatchAudioTrack'] => ({
  default: false,
  ...overrides,
});

const media = (audioTracks: S['WatchAudioTrack'][]): MediaFacts => ({
  fileId: 'file-1',
  isEpisode: false,
  hdr: false,
  audioTracks,
  subtitleTracks: [],
});

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  track_id: 'sub:0',
  combined_index: 0,
  source: 'embedded',
  forced: false,
  default: false,
  hearing_impaired: false,
  delivery: 'sidecar',
  language: 'en',
  ...overrides,
});

const rowsOf = (tracks: S['WatchAudioTrack'][], lang: 'de' | 'en' = 'en', t = text()) =>
  audioRows(playbackPlan({ selected_tracks: {} }), media(tracks), lang, t);

describe('audioIdentity', () => {
  it("names the track by the server's address: the plan's file and the audio ordinal", () => {
    const plan = playbackPlan({ effective_media_file_id: 'file-9' });
    expect(audioIdentity(plan, 2)).toEqual({ id: 'file:file-9:audio:2', index: 2 });
  });
});

describe('the audio channels badge', () => {
  it.each([
    [8, '7.1'],
    [6, '5.1'],
    [2, 'Stereo'],
    [1, '1 ch'],
    [4, '4 ch'],
    [10, '10 ch'],
  ])('writes %i channels as %s', (channels, badge) => {
    expect(audioChannelsBadge(channels, 'Stereo')).toBe(badge);
  });

  it('has none for 0, a negative count or no count', () => {
    expect(audioChannelsBadge(0, 'Stereo')).toBeNull();
    expect(audioChannelsBadge(-1, 'Stereo')).toBeNull();
    expect(audioChannelsBadge(undefined, 'Stereo')).toBeNull();
  });

  it("says two channels in the app's language", () => {
    const [en, de] = [
      rowsOf([audio({ channels: 2 })], 'en', text({ stereo: 'Stereo' })),
      rowsOf([audio({ channels: 2 })], 'de', text({ stereo: 'Stereo (de)' })),
    ];
    expect(en[0]?.channels).toBe('Stereo');
    expect(de[0]?.channels).toBe('Stereo (de)');
  });
});

describe('audioRows', () => {
  it("lists the version's tracks in order and checks the one the plan plays", () => {
    const plan = playbackPlan({
      selected_tracks: { audio: { id: 'file:file-1:audio:1', index: 1 } },
    });
    const rows = audioRows(
      plan,
      media([audio({ title: 'One' }), audio({ title: 'Two' })]),
      'en',
      text(),
    );
    expect(rows.map((row) => [row.index, row.title, row.checked])).toEqual([
      [0, 'One', false],
      [1, 'Two', true],
    ]);
  });

  it('reads the ordinal from the id when the identity has no index', () => {
    const plan = playbackPlan({ selected_tracks: { audio: { id: 'file:file-1:audio:1' } } });
    const rows = audioRows(plan, media([audio(), audio()]), 'en', text());
    expect(rows.map((row) => row.checked)).toEqual([false, true]);
  });

  it('checks nothing when the plan names no audio', () => {
    expect(rowsOf([audio(), audio()]).some((row) => row.checked)).toBe(false);
  });

  describe('the title', () => {
    it('is the track title first', () => {
      const track = audio({ title: 'Commentary', embedded_title: 'Embedded', language: 'en' });
      expect(rowsOf([track])[0]?.title).toBe('Commentary');
    });

    it('is the embedded title when there is no title', () => {
      expect(rowsOf([audio({ embedded_title: 'Embedded', language: 'en' })])[0]?.title).toBe(
        'Embedded',
      );
    });

    it('is the raw language, codec and channels joined by spaces when both titles are empty', () => {
      const track = audio({
        title: '',
        embedded_title: '',
        language: 'de',
        codec: 'ac3',
        channels: 6,
      });
      expect(rowsOf([track])[0]?.title).toBe('de ac3 5.1');
      expect(rowsOf([audio({ codec: 'aac' })])[0]?.title).toBe('aac');
    });

    it('is "Audio" for a track that says nothing about itself', () => {
      expect(rowsOf([audio()])[0]?.title).toBe('Audio');
      expect(rowsOf([audio()], 'en', text({ audio: 'Ton' }))[0]?.title).toBe('Ton');
    });
  });

  it('marks only the file default track as the default', () => {
    const rows = rowsOf([audio({ default: true }), audio({ default: false })]);
    expect(rows.map((row) => row.isDefault)).toEqual([true, false]);
  });

  describe('the meta line', () => {
    const full = audio({
      title: 'Surround',
      language: 'de',
      layout: '5.1(side)',
      bitrate: 640,
      sample_rate: 48000,
      bit_depth: 24,
    });

    it('joins language name, layout, bitrate, sample rate and bit depth with a middle dot', () => {
      expect(rowsOf([full], 'en')[0]?.meta).toBe(
        'German · 5.1(side) · 640 kbps · 48,000 Hz · 24-bit',
      );
    });

    it('groups thousands the German way under a German UI', () => {
      expect(rowsOf([full], 'de')[0]?.meta).toBe(
        'Deutsch · 5.1(side) · 640 kbps · 48.000 Hz · 24-bit',
      );
      expect(rowsOf([audio({ bitrate: 1536 })], 'de')[0]?.meta).toBe('1.536 kbps');
      expect(rowsOf([audio({ bitrate: 1536 })], 'en')[0]?.meta).toBe('1,536 kbps');
    });

    it('leaves out the language when it is the title, ignoring case', () => {
      expect(
        rowsOf([audio({ title: 'deutsch', language: 'de', layout: 'stereo' })], 'de')[0]?.meta,
      ).toBe('stereo');
    });

    it('adds nothing for a bitrate or a sample rate of 0 or below', () => {
      expect(rowsOf([audio({ title: 'X', bitrate: -5, sample_rate: -48000 })])[0]?.meta).toBe('');
      expect(
        rowsOf([audio({ title: 'X', bitrate: 0, sample_rate: 0, layout: '7.1' })])[0]?.meta,
      ).toBe('7.1');
    });

    it('leaves out what the track does not say, and is empty when it says nothing', () => {
      expect(rowsOf([audio({ title: 'X', bitrate: 0, sample_rate: 0 })])[0]?.meta).toBe('');
      expect(rowsOf([audio({ title: 'X', layout: '7.1' })])[0]?.meta).toBe('7.1');
    });
  });
});

describe('groupThousands', () => {
  it.each([
    [0, 'de', '0'],
    [999, 'de', '999'],
    [1000, 'de', '1.000'],
    [48000, 'de', '48.000'],
    [1234567, 'de', '1.234.567'],
    [48000, 'en', '48,000'],
    [44100.4, 'en', '44,100'],
  ] as const)('writes %i as %s in %s', (value, lang, expected) => {
    expect(groupThousands(value, lang)).toBe(expected);
  });
});

describe('subtitleFormat', () => {
  it.each([
    ['ass', 'ASS'],
    ['SSA', 'ASS'],
    ['srt', 'SRT'],
    ['subrip', 'SRT'],
    ['vtt', 'VTT'],
    ['webvtt', 'VTT'],
    ['pgs', 'PGS'],
    ['hdmv_pgs_subtitle', 'PGS'],
    ['dvd_subtitle', 'DVD'],
    ['dvb_subtitle', 'DVB'],
  ])('names %s as %s', (codec, name) => {
    expect(subtitleFormat(codec)).toBe(name);
  });

  it('names no other codec, and no missing one', () => {
    expect(subtitleFormat('mov_text')).toBeNull();
    expect(subtitleFormat(undefined)).toBeNull();
    expect(subtitleFormat('')).toBeNull();
  });
});

describe('subtitleRows', () => {
  const planWith = (inventory: InventoryItem[], subtitle?: { id: string; index?: number }) =>
    playbackPlan({
      selected_tracks: {
        audio: { id: 'file:file-1:audio:0', index: 0 },
        ...(subtitle ? { subtitle } : {}),
      },
      subtitle: { mode: 'sidecar', inventory },
    });
  const three = [
    item({ track_id: 'sub:0', combined_index: 0, language: 'en' }),
    item({ track_id: 'sub:1', combined_index: 1, language: 'de' }),
    item({ track_id: 'sub:2', combined_index: 2, language: 'fr' }),
  ];

  it('checks the selected track and none when the plan plays no subtitle', () => {
    expect(
      subtitleRows(planWith(three, { id: 'sub:1', index: 1 }), 'en', text()).map((row) => [
        row.item.track_id,
        row.checked,
      ]),
    ).toEqual([
      ['sub:0', false],
      ['sub:1', true],
      ['sub:2', false],
    ]);
    expect(subtitleRows(planWith(three), 'en', text()).some((row) => row.checked)).toBe(false);
  });

  it('orders embedded, then external, then downloaded, and keeps the server order inside a group', () => {
    const inventory = [
      item({ track_id: 'd1', source: 'downloaded' }),
      item({ track_id: 'x1', source: 'external' }),
      item({ track_id: 'e1', source: 'embedded' }),
      item({ track_id: 'd2', source: 'downloaded' }),
      item({ track_id: 'e2', source: 'embedded' }),
      item({ track_id: 'x2', source: 'external' }),
    ];
    expect(subtitleRows(planWith(inventory), 'en', text()).map((row) => row.item.track_id)).toEqual(
      ['e1', 'e2', 'x1', 'x2', 'd1', 'd2'],
    );
  });

  it('takes a source it does not know for embedded', () => {
    const rows = subtitleRows(planWith([item({ source: 'cloud' })]), 'en', text());
    expect(rows[0]?.source).toBe('embedded');
  });

  it('names the language in the app\'s language, else "Track n"', () => {
    const rows = subtitleRows(
      planWith([
        item({ language: 'de' }),
        item({ track_id: 'sub:9', language: '', combined_index: 3 }),
      ]),
      'de',
      text(),
    );
    expect(rows.map((row) => row.language)).toEqual(['Deutsch', 'Track 4']);
  });

  it('carries the format badge of the codec', () => {
    const rows = subtitleRows(
      planWith([item({ codec: 'subrip' }), item({ track_id: 'b', codec: 'mov_text' })]),
      'en',
      text(),
    );
    expect(rows.map((row) => row.format)).toEqual(['SRT', null]);
  });

  describe('the label line', () => {
    const detail = (overrides: Partial<InventoryItem>) =>
      subtitleRows(planWith([item(overrides)]), 'en', text())[0]?.detail;

    it('shows a label that says more than the language', () => {
      expect(detail({ language: 'de', label: 'German (Forced)' })).toBe('German (Forced)');
    });

    it('hides an empty label, the raw code and the language name', () => {
      expect(detail({ language: 'de', label: undefined })).toBeNull();
      expect(detail({ language: 'de', label: '' })).toBeNull();
      expect(detail({ language: 'de', label: 'de' })).toBeNull();
      expect(detail({ language: 'de', label: 'German' })).toBeNull();
    });

    it('hides a label that is only the codec or the format name', () => {
      expect(detail({ language: 'de', codec: 'hdmv_pgs_subtitle', label: 'PGS' })).toBeNull();
      expect(detail({ language: 'de', codec: 'subrip', label: 'SRT' })).toBeNull();
      expect(detail({ language: 'de', codec: 'subrip', label: 'SubRip' })).toBeNull();
      expect(detail({ language: 'de', codec: 'ass', label: 'A.S.S.' })).toBeNull();
    });

    it('shows a label of punctuation only, even with an empty codec', () => {
      expect(detail({ language: 'de', codec: '', label: '—' })).toBe('—');
      expect(detail({ language: 'de', label: '—' })).toBe('—');
    });

    it('shows a label that merely contains the format name', () => {
      expect(detail({ language: 'de', codec: 'subrip', label: 'SRT (Forced)' })).toBe(
        'SRT (Forced)',
      );
    });
  });
});

describe('the tracks a pick names', () => {
  const current = () =>
    playbackPlan({
      selected_tracks: {
        audio: { id: 'file:file-1:audio:0', index: 0 },
        subtitle: { id: 'sub:1', index: 1 },
      },
    });

  it('an audio pick names the new audio and keeps the subtitle the plan plays', () => {
    expect(tracksForAudioPick(current(), 2)).toEqual({
      audio: { id: 'file:file-1:audio:2', index: 2 },
      subtitle: { id: 'sub:1', index: 1 },
    });
  });

  it('an audio pick sends no subtitle when the plan plays none (that means off)', () => {
    const plan = playbackPlan({
      selected_tracks: { audio: { id: 'file:file-1:audio:0', index: 0 } },
    });
    expect(tracksForAudioPick(plan, 1)).toEqual({ audio: { id: 'file:file-1:audio:1', index: 1 } });
  });

  it('a subtitle pick names the track by id and combined index and keeps the audio', () => {
    expect(
      tracksForSubtitlePick(current(), item({ track_id: 'sub:7', combined_index: 4 })),
    ).toEqual({
      audio: { id: 'file:file-1:audio:0', index: 0 },
      subtitle: { id: 'sub:7', index: 4 },
    });
  });

  it('Off sends the current audio and no subtitle member', () => {
    const tracks = tracksForSubtitlePick(current(), null);
    expect(tracks).toEqual({ audio: { id: 'file:file-1:audio:0', index: 0 } });
    expect('subtitle' in tracks).toBe(false);
  });
});
