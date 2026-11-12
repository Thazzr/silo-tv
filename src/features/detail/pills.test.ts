import { describe, expect, it } from 'vitest';
import { translate, type Language } from '../../i18n';
import { subtitleSettings, type SubtitleSettings } from '../../playback/subtitleAuto';
import { audioTrack, fileVersion, storedSubtitle, subtitleTrack } from '../../test/detailFixtures';
import {
  audioRows,
  audioSummary,
  autoAudioIndex,
  autoSubtitle,
  editionDetail,
  startChoices,
  subtitleLists,
  subtitlePill,
  subtitleSummary,
  versionDetail,
  versionLabel,
  versionSummary,
  type SubtitleLists,
  type SubtitlePick,
} from './pills';

const tFor =
  (lang: Language) =>
  (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(lang, key, params);
const t = tFor('en');
const tDe = tFor('de');

const video = (overrides: object = {}) => ({
  dv_config_present: false,
  dv_bl_compat_id_present: false,
  interlaced: false,
  ...overrides,
});

describe('versionSummary', () => {
  it('reads resolution, video codec, dynamic range and audio, in that order', () => {
    const version = fileVersion({
      resolution: '2160p',
      codec_video: 'hevc',
      hdr: true,
      video_tracks: [video({ video_range_type: 'HDR10' })],
      codec_audio: 'dts',
    });
    expect(versionSummary(version)).toBe('2160p · HEVC · HDR10 · DTS');
  });

  it('leaves out what a file does not say, and names the container when it says nothing', () => {
    expect(
      versionSummary(fileVersion({ resolution: '1080p', codec_video: '', codec_audio: '' })),
    ).toBe('1080p');
    expect(
      versionSummary(
        fileVersion({ resolution: '', codec_video: '', codec_audio: '', container: 'mkv' }),
      ),
    ).toBe('MKV');
  });

  it("takes Atmos from the first track's profile, only when that track is the file's own codec", () => {
    const atmos = audioTrack({ default: true, codec: 'eac3', profile: 'Dolby Atmos' });
    const same = fileVersion({ codec_audio: 'eac3', audio_tracks: [atmos] });
    expect(versionSummary(same)).toContain('DD+ Atmos');
    const other = fileVersion({ codec_audio: 'ac3', audio_tracks: [atmos] });
    expect(versionSummary(other)).toContain('AC3');
    expect(versionSummary(other)).not.toContain('Atmos');
  });
});

describe('versionDetail and versionLabel', () => {
  const big = fileVersion({ container: 'mkv', file_size: 4.5 * 1024 ** 3, bitrate: 12300 });

  it('lists container, size and bitrate, with the decimal mark of the language', () => {
    expect(versionDetail(big, 'en')).toBe('MKV · 4.5 GB · 12.3 Mbit/s');
    expect(versionDetail(big, 'de')).toBe('MKV · 4,5 GB · 12,3 Mbit/s');
  });

  it('is the summary when there is one, else the detail line, else "Version {id}"', () => {
    expect(versionLabel(big, 'en', t)).toBe('1080p · H264 · AAC');
    const bare = fileVersion({
      file_id: 'f9',
      resolution: '',
      codec_video: '',
      codec_audio: '',
      container: '',
      file_size: 0,
      bitrate: 0,
    });
    expect(versionLabel(bare, 'en', t)).toBe('Version f9');
    expect(versionLabel(bare, 'de', tDe)).toBe('Version f9');
  });
});

describe('editionDetail', () => {
  it('says how many files an edition has, only when it has several, then its default file', () => {
    const standing = fileVersion({ resolution: '2160p', codec_video: 'hevc', codec_audio: '' });
    expect(editionDetail(2, standing, t)).toBe('2 versions · 2160p · HEVC');
    expect(editionDetail(2, standing, tDe)).toBe('2 Versionen · 2160p · HEVC');
    expect(editionDetail(1, standing, t)).toBe('2160p · HEVC');
  });
});

describe('autoAudioIndex', () => {
  const tracks = [
    audioTrack({ language: 'en' }),
    audioTrack({ language: 'de', default: true }),
    audioTrack({ language: 'fr' }),
  ];

  it('is the track the server resolved for the profile when it is in the list', () => {
    expect(
      autoAudioIndex(fileVersion({ audio_tracks: tracks, effective_audio_track_index: 2 })),
    ).toBe(2);
    expect(
      autoAudioIndex(fileVersion({ audio_tracks: tracks, effective_audio_track_index: 0 })),
    ).toBe(0);
  });

  it('is the default track when the resolved one is missing or outside the list', () => {
    expect(autoAudioIndex(fileVersion({ audio_tracks: tracks }))).toBe(1);
    expect(
      autoAudioIndex(fileVersion({ audio_tracks: tracks, effective_audio_track_index: 3 })),
    ).toBe(1);
    expect(
      autoAudioIndex(fileVersion({ audio_tracks: tracks, effective_audio_track_index: -1 })),
    ).toBe(1);
  });

  it('is the first track when none is the default, and 0 without tracks', () => {
    const plain = [audioTrack({ language: 'en' }), audioTrack({ language: 'de' })];
    expect(autoAudioIndex(fileVersion({ audio_tracks: plain }))).toBe(0);
    expect(autoAudioIndex(fileVersion())).toBe(0);
  });
});

describe('audioSummary', () => {
  const german = audioTrack({ language: 'de', codec: 'eac3', channels: 6 });

  it('reads language, codec and channels, in the app language', () => {
    expect(audioSummary(german, 'de', tDe)).toBe('Deutsch · EAC3 · 5.1');
    expect(audioSummary(german, 'en', t)).toBe('German · EAC3 · 5.1');
  });

  it('says Unknown for a track without a language, or an undetermined one', () => {
    expect(audioSummary({ ...german, language: undefined }, 'en', t)).toBe('Unknown · EAC3 · 5.1');
    expect(audioSummary({ ...german, language: 'und' }, 'de', tDe)).toBe('Unbekannt · EAC3 · 5.1');
  });

  it('words stereo and other channel counts, and leaves out what is missing', () => {
    expect(audioSummary(audioTrack({ language: 'en', codec: 'aac', channels: 2 }), 'de', tDe)).toBe(
      'Englisch · AAC · Stereo',
    );
    expect(audioSummary(audioTrack({ language: 'en', codec: 'aac', channels: 8 }), 'en', t)).toBe(
      'English · AAC · 7.1',
    );
    expect(audioSummary(audioTrack({ language: 'en' }), 'en', t)).toBe('English');
  });
});

describe('audioRows', () => {
  it('lists every track in order with its badges, and marks the default one', () => {
    const version = fileVersion({
      audio_tracks: [
        audioTrack({ language: 'en', codec: 'truehd', channels: 8, default: true }),
        audioTrack({ language: 'de', codec: 'ac3', channels: 6 }),
      ],
    });
    const rows = audioRows(version, 'en', t);
    expect(
      rows.map((row) => [row.index, row.title, row.codec, row.channels, row.isDefault]),
    ).toEqual([
      [0, 'English', 'TrueHD', '7.1', true],
      [1, 'German', 'AC3', '5.1', false],
    ]);
  });

  it("puts the track's own title first when it says more than the language, then the details", () => {
    const version = fileVersion({
      audio_tracks: [
        audioTrack({
          language: 'de',
          title: 'Deutsch DTS-HD MA 5.1 (Blu-ray)',
          layout: '5.1(side)',
          bitrate: 1536,
          sample_rate: 48000,
          bit_depth: 24,
        }),
      ],
    });
    expect(audioRows(version, 'en', t)[0]!.meta).toBe(
      'Deutsch DTS-HD MA 5.1 (Blu-ray) · 5.1(side) · 1,536 kbps · 48,000 Hz · 24-bit',
    );
    expect(audioRows(version, 'de', tDe)[0]!.meta).toBe(
      'Deutsch DTS-HD MA 5.1 (Blu-ray) · 5.1(side) · 1.536 kbps · 48.000 Hz · 24 Bit',
    );
  });

  it('shows no second line for a title that is only the language', () => {
    const version = fileVersion({
      audio_tracks: [audioTrack({ language: 'de', title: 'Deutsch', embedded_title: 'Deutsch' })],
    });
    const [row] = audioRows(version, 'de', tDe);
    expect(row!.title).toBe('Deutsch');
    expect(row!.meta).toBe('');
  });

  it('is titled by the track, else by what it says of itself, when it names no language', () => {
    const version = fileVersion({
      audio_tracks: [
        audioTrack({ title: 'Commentary' }),
        audioTrack({ embedded_title: 'Stereo mix' }),
        audioTrack({ codec: 'aac', channels: 2 }),
        audioTrack(),
      ],
    });
    expect(audioRows(version, 'en', t).map((row) => row.title)).toEqual([
      'Commentary',
      'Stereo mix',
      'aac Stereo',
      'Audio',
    ]);
  });
});

describe('audioRows: empty numbers', () => {
  it('shows no "0 Hz" or "0 kbps" for a track that says zero', () => {
    const version = fileVersion({
      audio_tracks: [audioTrack({ language: 'de', sample_rate: 0, bitrate: 0, bit_depth: 0 })],
    });
    expect(audioRows(version, 'en', t)[0]!.meta).toBe('');
  });
});

describe('subtitleLists', () => {
  const lists = (
    tracks: ReturnType<typeof subtitleTrack>[],
    downloaded: ReturnType<typeof storedSubtitle>[] = [],
    lang: Language = 'en',
  ): SubtitleLists =>
    subtitleLists(fileVersion({ subtitle_tracks: tracks }), downloaded, lang, tFor(lang));

  it('sorts tracks into embedded, external and downloaded, in the order Auto searches them', () => {
    const result = lists(
      [subtitleTrack({ language: 'en', external: true }), subtitleTrack({ language: 'en' })],
      [storedSubtitle({ id: '9', language: 'fr' })],
    );
    expect(result.embedded.map((row) => row.key)).toEqual(['embedded:1']);
    expect(result.external.map((row) => row.key)).toEqual(['external:0']);
    expect(result.downloaded.map((row) => row.key)).toEqual(['downloaded:9']);
    expect(result.all.map((row) => row.source)).toEqual(['embedded', 'external', 'downloaded']);
  });

  it("numbers the tracks like the plan: sidecar files first, then embedded ones, each in the file's order", () => {
    const result = lists([
      subtitleTrack({ language: 'de' }),
      subtitleTrack({ language: 'en', external: true }),
      subtitleTrack({ language: 'fr' }),
      subtitleTrack({ language: 'es', external: true }),
    ]);
    const byLanguage = Object.fromEntries(
      result.all.map((row) => [row.item.language, row.item.combined_index]),
    );
    expect(byLanguage).toEqual({ en: 0, es: 1, de: 2, fr: 3 });
    // A downloaded track has no ordinal before the plan exists.
    expect(lists([], [storedSubtitle()]).downloaded[0]!.item.combined_index).toBe(-1);
  });

  it('sorts by language name, then forced, then default, then title', () => {
    const result = lists(
      [
        subtitleTrack({ language: 'en', title: 'B plain' }),
        subtitleTrack({ language: 'en', title: 'A plain' }),
        subtitleTrack({ language: 'en', title: 'Default', default: true }),
        subtitleTrack({ language: 'en', title: 'Forced one', forced: true }),
        subtitleTrack({ language: 'de' }),
      ],
      [],
      'de',
    );
    expect(result.embedded.map((row) => [row.language, row.item.label])).toEqual([
      ['Deutsch', 'de'],
      ['Englisch', 'Forced one'],
      ['Englisch', 'Default'],
      ['Englisch', 'A plain'],
      ['Englisch', 'B plain'],
    ]);
  });

  it('words the language in the app language, and says Unknown for none', () => {
    expect(lists([subtitleTrack({ language: 'de' })], [], 'de').all[0]!.language).toBe('Deutsch');
    expect(lists([subtitleTrack({ language: 'de' })]).all[0]!.language).toBe('German');
    expect(lists([subtitleTrack()]).all[0]!.language).toBe('Unknown');
    expect(lists([subtitleTrack({ language: 'und' })], [], 'de').all[0]!.language).toBe(
      'Unbekannt',
    );
  });

  it('names the format short, and the codec in capitals when it has no short name', () => {
    const result = lists([
      subtitleTrack({ language: 'a1', codec: 'subrip' }),
      subtitleTrack({ language: 'a2', codec: 'hdmv_pgs_subtitle' }),
      subtitleTrack({ language: 'a3', codec: 'mov_text' }),
      subtitleTrack({ language: 'a4' }),
    ]);
    expect(Object.fromEntries(result.all.map((row) => [row.item.language, row.format]))).toEqual({
      a1: 'SRT',
      a2: 'PGS',
      a3: 'MOV_TEXT',
      a4: null,
    });
  });

  it('takes a title that is only a flag word for the flag, and shows it as no description', () => {
    const [row] = lists([subtitleTrack({ language: 'en', title: 'Forced' })]).all;
    expect(row!.forced).toBe(true);
    expect(row!.description).toBeNull();
    // The flag the file sets is the one the resolver sees.
    expect(row!.item.forced).toBe(false);
    const [sdh] = lists([subtitleTrack({ language: 'en', title: 'SDH' })]).all;
    expect(sdh!.hearingImpaired).toBe(true);
    expect(sdh!.description).toBeNull();
    const [cc] = lists([
      subtitleTrack({ language: 'en', hearing_impaired: true, title: 'English' }),
    ]).all;
    expect(cc!.hearingImpaired).toBe(true);
    expect(cc!.description).toBe('English');
  });

  it('describes a track by its title, unless that only names the codec or the format', () => {
    const rows = lists([
      subtitleTrack({ language: 'a1', title: 'Full dialogue', codec: 'subrip' }),
      subtitleTrack({ language: 'a2', title: 'SRT', codec: 'subrip' }),
      subtitleTrack({ language: 'a3', title: 'subrip', codec: 'subrip' }),
      subtitleTrack({ language: 'a4', embedded_title: 'Embedded name' }),
      subtitleTrack({ language: 'a5', file_name: 'film.en.srt' }),
    ]).all;
    expect(Object.fromEntries(rows.map((row) => [row.item.language, row.description]))).toEqual({
      a1: 'Full dialogue',
      a2: null,
      a3: null,
      a4: 'Embedded name',
      a5: 'film.en.srt',
    });
  });

  it('sorts the downloaded ones by score, then provider, and describes them by their release', () => {
    const rows = lists(
      [],
      [
        storedSubtitle({ id: '1', score: 10, provider: 'b', release_name: 'Low' }),
        storedSubtitle({ id: '2', score: 90, provider: 'z', release_name: 'High Z' }),
        storedSubtitle({ id: '3', score: 90, provider: 'a', release_name: 'High A' }),
      ],
    ).downloaded;
    expect(rows.map((row) => row.description)).toEqual(['High A', 'High Z', 'Low']);
    expect(rows[0]!.item.label).toBe('High A (a)');
    expect(rows[0]!.item.source).toBe('downloaded');
  });

  it('breaks a tie of equal scores by provider, not by release', () => {
    const rows = subtitleLists(
      fileVersion(),
      [
        storedSubtitle({ id: '1', score: 50, provider: 'b', release_name: 'A release' }),
        storedSubtitle({ id: '2', score: 50, provider: 'a', release_name: 'Z release' }),
      ],
      'en',
      t,
    ).downloaded;
    expect(rows.map((row) => row.description)).toEqual(['Z release', 'A release']);
  });

  it('labels a downloaded track by its release, its provider, or its language', () => {
    const label = (overrides: Parameters<typeof storedSubtitle>[0]) =>
      lists([], [storedSubtitle(overrides)]).downloaded[0]!.item.label;
    expect(label({ release_name: 'R', provider: '' })).toBe('R');
    expect(label({ release_name: '', provider: 'P' })).toBe('P');
    expect(label({ release_name: '', provider: '', language: 'fr' })).toBe('fr');
    expect(lists([], [storedSubtitle({ release_name: '' })]).downloaded[0]!.description).toBeNull();
  });

  it('is empty for a file without subtitle tracks, and keeps the hearing-impaired flag of a download', () => {
    expect(subtitleLists(fileVersion(), [], 'en', t).all).toEqual([]);
    expect(
      lists([], [storedSubtitle({ hearing_impaired: true })]).downloaded[0]!.hearingImpaired,
    ).toBe(true);
  });
});

describe('autoSubtitle', () => {
  const settings = (overrides: Partial<SubtitleSettings> = {}): SubtitleSettings => ({
    ...subtitleSettings({}),
    ...overrides,
  });
  const lists = subtitleLists(
    fileVersion({
      subtitle_tracks: [
        subtitleTrack({ language: 'de', forced: true, codec: 'subrip' }),
        subtitleTrack({ language: 'de', codec: 'subrip' }),
        subtitleTrack({ language: 'en', codec: 'subrip' }),
      ],
    }),
    [],
    'en',
    t,
  );

  it("picks by the player's rule: the forced track of the audio's language when it is the preferred one", () => {
    const row = autoSubtitle(lists, settings({ language: 'de' }), 'de');
    expect(row?.item.language).toBe('de');
    expect(row?.forced).toBe(true);
  });

  it('picks the preferred language when the audio is another one', () => {
    const row = autoSubtitle(lists, settings({ language: 'en' }), 'fr');
    expect(row?.item.language).toBe('en');
  });

  it('is nothing when the settings resolve to none, or the file has no track', () => {
    expect(autoSubtitle(lists, settings({ mode: 'off', showForced: false }), 'de')).toBeUndefined();
    expect(
      autoSubtitle({ embedded: [], external: [], downloaded: [], all: [] }, settings(), 'de'),
    ).toBeUndefined();
  });

  it('is the remembered track in mode always, when the file has it', () => {
    const row = autoSubtitle(
      lists,
      settings({
        mode: 'always',
        language: 'de',
        signature: {
          source: 'embedded',
          language: 'de',
          codec: 'subrip',
          forced: false,
          hearing_impaired: false,
        },
      }),
      'en',
    );
    expect(row?.forced).toBe(false);
    expect(row?.item.language).toBe('de');
  });
});

describe('subtitleSummary', () => {
  const rowOf = (track: ReturnType<typeof subtitleTrack>, lang: Language = 'en') =>
    subtitleLists(fileVersion({ subtitle_tracks: [track] }), [], lang, tFor(lang)).all[0]!;

  it('reads the language, the marker of a forced or SDH track, then the format', () => {
    const forced = rowOf(subtitleTrack({ language: 'de', forced: true, codec: 'subrip' }), 'de');
    expect(subtitleSummary(forced, tDe)).toBe('Deutsch (Erzwungen) · SRT');
    const sdh = rowOf(subtitleTrack({ language: 'en', hearing_impaired: true, codec: 'ass' }));
    expect(subtitleSummary(sdh, t)).toBe('English (SDH) · ASS');
    const both = rowOf(
      subtitleTrack({ language: 'en', hearing_impaired: true, forced: true, codec: 'subrip' }),
    );
    expect(subtitleSummary(both, t)).toBe('English (SDH) (Forced) · SRT');
  });

  it('leaves out the format when unknown, and the marker the name already says', () => {
    expect(subtitleSummary(rowOf(subtitleTrack({ language: 'en' })), t)).toBe('English');
    const named = rowOf(subtitleTrack({ language: 'en' }));
    expect(subtitleSummary({ ...named, language: 'English SDH', hearingImpaired: true }, t)).toBe(
      'English SDH',
    );
    expect(subtitleSummary({ ...named, language: 'Forced English', forced: true }, t)).toBe(
      'Forced English',
    );
  });
});

describe('subtitlePill', () => {
  const lists = subtitleLists(
    fileVersion({
      subtitle_tracks: [
        subtitleTrack({ language: 'de', forced: true, codec: 'subrip' }),
        subtitleTrack({ language: 'en', codec: 'ass' }),
      ],
    }),
    [],
    'en',
    t,
  );
  const [english, german] = lists.embedded;
  // `'none'` is no Auto track (a default parameter could not tell it from an omitted one).
  const pill = (
    pick: SubtitlePick,
    auto: typeof german | 'none' = german,
    saved = false,
    translate: typeof t = t,
  ) => subtitlePill(pick, lists, auto === 'none' ? undefined : auto, saved, translate);

  it('says "Auto: " and the track Auto plays, or "Auto: Off" when there is none', () => {
    const auto = pill({ mode: 'auto' });
    expect(auto.summary).toBe('Auto: German (Forced) · SRT');
    expect(auto.autoDescription).toBe('German (Forced) · SRT');
    expect(auto.checked).toEqual({ mode: 'auto' });
    const none = pill({ mode: 'auto' }, 'none');
    expect(none.summary).toBe('Auto: Off');
    expect(none.autoDescription).toBe('Off');
    expect(pill({ mode: 'auto' }, german, false, tDe).summary).toBe(
      'Automatisch: German (Erzwungen) · SRT',
    );
    expect(pill({ mode: 'auto' }, 'none', false, tDe).summary).toBe('Automatisch: Aus');
  });

  it("describes the Auto row as the pill's summary without the prefix: forced, SDH, or none", () => {
    const sdhLists = subtitleLists(
      fileVersion({
        subtitle_tracks: [subtitleTrack({ language: 'en', hearing_impaired: true, codec: 'ass' })],
      }),
      [],
      'en',
      t,
    );
    const sdh = subtitlePill({ mode: 'auto' }, sdhLists, sdhLists.embedded[0], false, t);
    expect(sdh.autoDescription).toBe('English (SDH) · ASS');
    expect(sdh.summary).toBe(`Auto: ${sdh.autoDescription}`);
    const forced = pill({ mode: 'auto' });
    expect(forced.summary).toBe(`Auto: ${forced.autoDescription}`);
    expect(pill({ mode: 'auto' }, 'none').autoDescription).toBe('Off');
  });

  it('says Off for a pick of Off, and keeps the Auto row describing what Auto would play', () => {
    const off = pill({ mode: 'off' });
    expect(off.summary).toBe('Off');
    expect(off.checked).toEqual({ mode: 'off' });
    expect(off.autoDescription).toBe('German (Forced) · SRT');
    expect(pill({ mode: 'off' }, german, false, tDe).summary).toBe('Aus');
  });

  it('names a picked track without the prefix, and checks its row', () => {
    const picked = pill({ mode: 'track', key: english!.key });
    expect(picked.summary).toBe('English · ASS');
    expect(picked.checked).toEqual({ mode: 'track', key: english!.key });
    expect(picked.autoDescription).toBe('German (Forced) · SRT');
  });

  it('shows the track a saved override resolves to without the prefix, and offers the reset', () => {
    const saved = pill({ mode: 'auto' }, english, true);
    expect(saved.summary).toBe('English · ASS');
    expect(saved.checked).toEqual({ mode: 'track', key: english!.key });
    expect(saved.autoDescription).toBe('Reset to profile defaults');
    expect(pill({ mode: 'auto' }, english, true, tDe).autoDescription).toBe(
      'Auf Standards des Profils zurücksetzen',
    );
  });

  it('is plain Auto when the saved override resolves to no track in this file', () => {
    const lost = pill({ mode: 'auto' }, 'none', true);
    expect(lost.summary).toBe('Auto: Off');
    expect(lost.checked).toEqual({ mode: 'auto' });
  });

  it('falls back to Auto for a pick whose track is no longer in the list', () => {
    expect(pill({ mode: 'track', key: 'downloaded:gone' }).summary).toBe(
      'Auto: German (Forced) · SRT',
    );
  });
});

describe('startChoices', () => {
  const version = fileVersion({ file_id: 'f1' });
  const lists = subtitleLists(
    fileVersion({
      subtitle_tracks: [
        subtitleTrack({ language: 'en', external: true }),
        subtitleTrack({ language: 'de' }),
      ],
    }),
    [storedSubtitle({ id: '5' })],
    'en',
    t,
  );
  const auto: SubtitlePick = { mode: 'auto' };
  const german = lists.embedded[0]!;
  const download = lists.downloaded[0]!;

  it('names nothing without a version', () => {
    expect(startChoices(undefined, true, 1, auto, lists)).toEqual({});
  });

  it('names nothing for Auto everywhere and no version picked', () => {
    expect(startChoices(version, false, null, auto, lists)).toEqual({});
  });

  it('names the file when the viewer picked one', () => {
    expect(startChoices(version, true, null, auto, lists)).toEqual({ fileId: 'f1' });
  });

  it('names the audio track and, with it, the file whose list the index belongs to', () => {
    expect(startChoices(version, false, 2, auto, lists)).toEqual({
      fileId: 'f1',
      audio: { index: 2 },
    });
    expect(startChoices(version, false, 0, auto, lists).audio).toEqual({ index: 0 });
  });

  it("names a picked subtitle by its ordinal in the plan's numbering, with the file", () => {
    const choices = startChoices(version, false, null, { mode: 'track', key: german.key }, lists);
    expect(choices).toEqual({ fileId: 'f1', subtitle: { index: 1 } });
  });

  it('names Off as an empty subtitle choice, which keeps the settings from choosing one', () => {
    expect(startChoices(version, false, null, { mode: 'off' }, lists)).toEqual({ subtitle: {} });
  });

  it('names no subtitle for a downloaded track: it has no ordinal before the plan exists', () => {
    expect(startChoices(version, false, null, { mode: 'track', key: download.key }, lists)).toEqual(
      {},
    );
  });

  it('names no subtitle for a pick that is no longer in the list', () => {
    expect(startChoices(version, false, null, { mode: 'track', key: 'embedded:9' }, lists)).toEqual(
      {},
    );
  });
});
