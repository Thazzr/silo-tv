import { describe, expect, it } from 'vitest';
import {
  SUBTITLE_DEFAULTS,
  playingAudioLanguage,
  resolveSubtitle,
  subtitleSettings,
  type InventoryItem,
  type SubtitleSettings,
  type SubtitleSignature,
} from './subtitleAuto';

/** A track of the plan's inventory; `index` is its position, which the expectations name. */
function track(index: number, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    track_id: `sub:${index}`,
    combined_index: index,
    source: 'embedded',
    forced: false,
    default: false,
    hearing_impaired: false,
    delivery: 'sidecar',
    language: 'en',
    codec: 'srt',
    ...overrides,
  };
}

function settings(overrides: Partial<SubtitleSettings> = {}): SubtitleSettings {
  return { mode: 'auto', language: null, showForced: true, signature: null, ...overrides };
}

/** The index of the track the resolver picks, or null. */
function pick(
  s: SubtitleSettings,
  inventory: InventoryItem[],
  audio: string | null,
): number | null {
  return resolveSubtitle(s, inventory, audio)?.combined_index ?? null;
}

// en full, en forced, fr full, fr forced: the inventory most of the cases share.
const X = [
  track(0, { language: 'en' }),
  track(1, { language: 'en', forced: true }),
  track(2, { language: 'fr' }),
  track(3, { language: 'fr', forced: true }),
];

describe('resolveSubtitle: the cases of the web client', () => {
  it.each<[string, Partial<SubtitleSettings>, InventoryItem[], string | null, number | null]>([
    // auto
    [
      '1 auto en, forced off, audio en: nothing',
      { language: 'en', showForced: false },
      X,
      'en',
      null,
    ],
    ['2 auto en, forced on, audio en: the en forced track', { language: 'en' }, X, 'en', 1],
    ['3 auto fr, audio en: the fr full track', { language: 'fr' }, X, 'en', 2],
    [
      '4 auto fr, forced off, audio ja: the fr full track',
      { language: 'fr', showForced: false },
      X,
      'ja',
      2,
    ],
    ['5a auto en, undetermined audio: the full en track', { language: 'en' }, X, 'und', 0],
    ['5b auto en, unknown audio: the full en track', { language: 'en' }, X, null, 0],
    ['6 auto with no language, audio ja: nothing', {}, X, 'ja', null],
    ['7 auto with no language, audio fr: the fr forced track', {}, X, 'fr', 3],
    [
      '8 auto with no language, forced off, audio fr: nothing',
      { showForced: false },
      X,
      'fr',
      null,
    ],
    ['9 auto with explicit None: nothing, not even forced', { language: '' }, X, 'ja', null],
    [
      '9b auto with explicit None, audio fr: not even the forced track',
      { language: '' },
      X,
      'fr',
      null,
    ],
    [
      'an embedded PGS track loses to an external text track of the same kind',
      { language: 'en' },
      [track(0, { codec: 'pgs' }), track(1, { source: 'external' })],
      'ja',
      1,
    ],
    // off
    [
      '10 off, forced on, audio fr: the fr forced track',
      { mode: 'off', language: 'en' },
      X,
      'fr',
      3,
    ],
    ['11 off, forced off, audio fr: nothing', { mode: 'off', showForced: false }, X, 'fr', null],
    ['12 off, forced on, undetermined audio: nothing', { mode: 'off' }, X, 'und', null],
    // always
    [
      '13 always en, audio ja: the full beats the forced track',
      { mode: 'always', language: 'en' },
      X,
      'ja',
      0,
    ],
    ['14 always with no language: nothing', { mode: 'always' }, X, 'en', null],
    [
      '15 always de, no de track: nothing, not any forced track',
      { mode: 'always', language: 'de' },
      X,
      'en',
      null,
    ],
    // languages
    [
      '16a auto en, audio eng (639-2): the same language as en',
      { language: 'en', showForced: false },
      X,
      'eng',
      null,
    ],
    [
      '16b auto en, audio eng (639-2), forced on: the en forced track',
      { language: 'en' },
      X,
      'eng',
      1,
    ],
    [
      '17 auto en-US, audio en-GB: the same language, nothing',
      { language: 'en-US', showForced: false },
      [track(0, { language: 'en-GB' })],
      'en-GB',
      null,
    ],
    [
      '18 auto pt-BR, tracks pt-PT and pt-BR: the exact tag first',
      { language: 'pt-BR' },
      [track(0, { language: 'pt-PT' }), track(1, { language: 'pt-BR' })],
      'en',
      1,
    ],
    [
      "19 auto fr, only forced tracks en and fr: the fr one, as the language's only track",
      { language: 'fr' },
      [track(0, { language: 'en', forced: true }), track(1, { language: 'fr', forced: true })],
      'en',
      1,
    ],
    // ranking
    [
      '20 full beats SDH, embedded beats external, text beats PGS',
      { language: 'en' },
      [
        track(0, { hearing_impaired: true }),
        track(1, { source: 'external' }),
        track(2),
        track(3, { codec: 'hdmv_pgs_subtitle' }),
      ],
      'ja',
      2,
    ],
    [
      '21 a PGS track is picked when it is the only match',
      { language: 'en' },
      [track(0, { codec: 'hdmv_pgs_subtitle' })],
      'ja',
      0,
    ],
    [
      '22 a track that needs a burn-in loses to an SDH text track',
      { language: 'en' },
      [track(0, { codec: 'dvdsub' }), track(1, { hearing_impaired: true })],
      'ja',
      1,
    ],
    [
      '25 the default flag is ignored',
      { language: 'fr' },
      [track(0, { language: 'en', default: true }), track(1, { language: 'fr' })],
      'en',
      1,
    ],
    [
      '26 auto de, audio de: the de forced track, not the full one',
      { language: 'de' },
      [track(0, { language: 'de' }), track(1, { language: 'de', forced: true })],
      'de',
      1,
    ],
    [
      '27 auto with no language, German audio, a German forced track: that track',
      {},
      [track(0, { language: 'de', forced: true })],
      'de',
      0,
    ],
    [
      'an embedded PGS track needs a burn-in on this TV and loses to a forced text track',
      { language: 'en' },
      [track(0, { forced: true }), track(1, { codec: 'pgs' })],
      'ja',
      0,
    ],
    [
      'defaults: a full embedded PGS and a forced SRT in the audio language pick the forced SRT',
      {},
      [track(0, { codec: 'hdmv_pgs_subtitle' }), track(1, { forced: true })],
      'en',
      1,
    ],
    [
      'always: a language whose only track is PGS still gets it (deprioritised, not excluded)',
      { mode: 'always', language: 'en' },
      [track(0, { language: 'fr' }), track(1, { codec: 'pgs' })],
      'ja',
      1,
    ],
    [
      'an external PGS track needs a burn-in and loses to a forced text track',
      { language: 'en' },
      [track(0, { forced: true }), track(1, { codec: 'pgs', source: 'external' })],
      'ja',
      0,
    ],
    ['the first of two equal tracks wins', { language: 'en' }, [track(0), track(1)], 'ja', 0],
  ])('%s', (_name, overrides, inventory, audio, expected) => {
    expect(pick(settings(overrides), inventory, audio)).toBe(expected);
  });

  it('an empty inventory resolves to nothing in every mode', () => {
    for (const mode of ['auto', 'always', 'off'] as const) {
      expect(pick(settings({ mode, language: 'en' }), [], 'ja')).toBeNull();
    }
  });
});

describe('resolveSubtitle: remembered track', () => {
  const signature: SubtitleSignature = {
    source: 'embedded',
    language: 'en',
    codec: 'srt',
    label: 'English',
    forced: true,
    hearing_impaired: false,
  };
  const inventory = [track(0), track(1, { forced: true, label: 'English' })];

  it('23 always: an exact match wins, even though the track is forced', () => {
    expect(pick(settings({ mode: 'always', language: 'en', signature }), inventory, 'en')).toBe(1);
  });

  it('24 always: a signature that matches nothing falls back to the best track of the language', () => {
    const other = { ...signature, forced: false, codec: 'ass', label: 'Gone' };
    expect(
      pick(settings({ mode: 'always', language: 'en', signature: other }), inventory, 'ja'),
    ).toBe(0);
  });

  it('a signature scores the tracks of the language: the closer one wins over the priority', () => {
    const sdh = { ...signature, forced: false, hearing_impaired: true, label: undefined };
    const tracks = [track(0), track(1, { hearing_impaired: true })];
    expect(pick(settings({ mode: 'auto', language: 'en', signature: sdh }), tracks, 'ja')).toBe(1);
  });

  it('the exact match is only used in always: auto keeps the nearer language', () => {
    const regional = { ...signature, language: 'en-GB', forced: false, label: undefined };
    const tracks = [track(0), track(1, { language: 'en-GB' })];
    expect(
      pick(settings({ mode: 'always', language: 'en', signature: regional }), tracks, 'ja'),
    ).toBe(1);
    expect(
      pick(settings({ mode: 'auto', language: 'en', signature: regional }), tracks, 'ja'),
    ).toBe(0);
  });

  it('a signature with no label matches a track whatever its label', () => {
    const bare = { ...signature, label: undefined };
    const tracks = [track(0), track(1, { forced: true, label: 'Whatever' })];
    expect(pick(settings({ mode: 'always', signature: bare }), tracks, 'en')).toBe(1);
  });
});

describe('resolveSubtitle: languages', () => {
  it.each(['und', 'UND', ' ', '', 'original', 'x-silo-original'])(
    'the audio language %j is unknown: it is neither a match nor the forced track of any language',
    (audio) => {
      const tracks = [track(0, { language: audio, forced: true }), track(1, { language: 'en' })];
      expect(pick(settings({ mode: 'off' }), tracks, audio)).toBeNull();
      expect(pick(settings({ language: 'en' }), tracks, audio)).toBe(1);
    },
  );

  it.each(['und', 'original', 'x-silo-original'])(
    'the preferred language %j names nothing: always picks nothing',
    (language) => {
      expect(
        pick(settings({ mode: 'always', language }), [track(0, { language })], 'en'),
      ).toBeNull();
    },
  );

  it.each(['und', 'original', 'x-silo-original'])(
    'the preferred language %j in auto is no preference: the audio forced track shows',
    (language) => {
      expect(pick(settings({ language }), X, 'fr')).toBe(3);
    },
  );

  it('a track with an undetermined or empty language matches no preferred language', () => {
    const tracks = [track(0, { language: 'und' }), track(1, { language: undefined })];
    expect(pick(settings({ language: 'en' }), tracks, 'ja')).toBeNull();
  });

  it.each([
    ['eng', 'en'],
    ['ger', 'de'],
    ['deu', 'de'],
    ['jpn', 'ja'],
    ['fre', 'fr'],
    ['pt_BR', 'pt-BR'],
    ['EN-gb', 'en'],
  ])('ISO 639-2 and 639-1 are one language: %s and %s', (three, two) => {
    const tracks = [track(0, { language: three })];
    expect(pick(settings({ language: two }), tracks, 'sv')).toBe(0);
    // The same holds for the audio: audio in the language needs no full subtitles.
    expect(
      pick(settings({ language: two, showForced: false }), [track(0, { language: two })], three),
    ).toBeNull();
  });

  it('a different language never matches', () => {
    expect(pick(settings({ language: 'de' }), [track(0, { language: 'dan' })], 'ja')).toBeNull();
  });

  it('a bare language beats another region of it', () => {
    const tracks = [track(0, { language: 'pt-PT' }), track(1, { language: 'pt' })];
    expect(pick(settings({ language: 'pt-BR' }), tracks, 'en')).toBe(1);
  });
});

describe('subtitleSettings', () => {
  it('takes the watch data first', () => {
    const signature: SubtitleSignature = { forced: false, hearing_impaired: false };
    expect(
      subtitleSettings(
        {
          effective_subtitle_mode: 'always',
          effective_subtitle_language: 'de',
          effective_show_forced_subtitles: false,
          effective_subtitle_track_signature: signature,
        },
        { mode: 'off', language: 'fr', showForced: true },
      ),
    ).toEqual({ mode: 'always', language: 'de', showForced: false, signature });
  });

  it('falls back field by field, then to the contract defaults', () => {
    expect(
      subtitleSettings(
        { effective_subtitle_mode: 'off' },
        { mode: 'always', language: 'fr', showForced: false },
      ),
    ).toEqual({ mode: 'off', language: 'fr', showForced: false, signature: null });
    expect(subtitleSettings({})).toEqual({
      mode: 'auto',
      language: null,
      showForced: true,
      signature: null,
    });
    expect(SUBTITLE_DEFAULTS).toEqual({ mode: 'auto', language: null, showForced: true });
  });

  it('keeps an empty language: it is a stored None, not a missing value', () => {
    expect(
      subtitleSettings(
        { effective_subtitle_language: '' },
        { ...SUBTITLE_DEFAULTS, language: 'fr' },
      ).language,
    ).toBe('');
  });

  it.each(['', 'sometimes', 'ALWAYS'])('an unknown mode %j counts as auto', (mode) => {
    expect(subtitleSettings({ effective_subtitle_mode: mode }).mode).toBe('auto');
  });
});

describe('playingAudioLanguage', () => {
  const version = {
    audioTracks: [{ language: 'de' }, { language: ' ' }, {}],
    effectiveAudioIndex: 1,
    effectiveAudioLanguage: 'ja',
  };

  it('is the language of the track that plays', () => {
    expect(playingAudioLanguage(version, 0)).toBe('de');
  });

  it("falls back to the version's effective language only for the track it was resolved for", () => {
    expect(playingAudioLanguage(version, 1)).toBe('ja');
    expect(playingAudioLanguage(version, 2)).toBeNull();
  });

  it('is the effective language when the plan names no track, and null when nothing is known', () => {
    expect(playingAudioLanguage(version, undefined)).toBe('ja');
    expect(playingAudioLanguage({ audioTracks: [] }, undefined)).toBeNull();
    expect(playingAudioLanguage(undefined, 0)).toBeNull();
  });
});
