import { describe, expect, it } from 'vitest';
import type { components } from '../../api/generated/schema';
import { fileVersion, itemDetail, rollup } from '../../test/detailFixtures';
import { selectedVersion, sortByResolution, versionPicker } from './versions';

type S = components['schemas'];

const at = (resolution: string, extra: Partial<S['FileVersion']> = {}) =>
  fileVersion({ file_id: resolution, resolution, ...extra });

const variantOf = (
  id: string,
  versions: S['FileVersion'][],
  extra: Partial<S['PlaybackVariant']> = {},
  defaultFileId?: string,
): S['PlaybackVariant'] => ({
  variant_id: id,
  part_count: 1,
  parts: [
    { part_index: 0, versions, ...(defaultFileId ? { default_file_id: defaultFileId } : {}) },
  ],
  ...extra,
});

describe('selectedVersion without playback variants', () => {
  const sharp = fileVersion({ file_id: 'uhd', resolution: '2160p', hdr: true });
  const soft = fileVersion({ file_id: 'hd', resolution: '1080p' });

  it('is the sharpest version when nothing says otherwise, and none for a title without files', () => {
    expect(selectedVersion(itemDetail({ versions: [soft, sharp] }))?.file_id).toBe('uhd');
    expect(selectedVersion(itemDetail({ versions: [] }))).toBeUndefined();
  });

  it('is the version the profile played last', () => {
    const detail = itemDetail({
      versions: [soft, sharp],
      user_data: rollup({ last_file_id: 'hd' }),
    });
    expect(selectedVersion(detail)?.file_id).toBe('hd');
  });

  it('does not look at the version the server resolved: the web does not either', () => {
    const detail = itemDetail({
      versions: [sharp, soft],
      effective_version_resolution: '1080p',
      effective_version_hdr: false,
    });
    expect(selectedVersion(detail)?.file_id).toBe('uhd');
  });

  it('chooses within the edition the profile picked, and ignores an edition no file has', () => {
    const cut = fileVersion({ file_id: 'cut', resolution: '720p', edition_key: 'directors' });
    const picked = itemDetail({
      versions: [sharp, cut],
      effective_version_edition_key: 'directors',
    });
    expect(selectedVersion(picked)?.file_id).toBe('cut');
    const other = itemDetail({ versions: [sharp, cut], effective_version_edition_key: 'extended' });
    expect(selectedVersion(other)?.file_id).toBe('uhd');
  });

  it("takes the profile's edition before the one last played, and the last one when it has none", () => {
    const versions = [at('1080p', { edition_key: 'b' }), at('720p', { edition_key: 'a' })];
    const both = itemDetail({
      versions,
      effective_version_edition_key: 'a',
      user_data: rollup({ last_edition_key: 'b' }),
    });
    expect(selectedVersion(both)?.file_id).toBe('720p');
    const lastOnly = itemDetail({ versions, user_data: rollup({ last_edition_key: 'a' }) });
    expect(selectedVersion(lastOnly)?.file_id).toBe('720p');
  });

  it('does not take the file last played when it is not in the edition the profile chose', () => {
    const detail = itemDetail({
      versions: [at('2160p', { edition_key: 'a' }), at('720p', { edition_key: 'b' })],
      effective_version_edition_key: 'a',
      user_data: rollup({ last_file_id: '720p' }),
    });
    expect(selectedVersion(detail)?.file_id).toBe('2160p');
  });

  it('keeps to the resolution cap of the profile, and ignores one every file is above', () => {
    const detail = itemDetail({ versions: [at('2160p'), at('1080p'), at('720p')] });
    expect(selectedVersion(detail, '1080p')?.file_id).toBe('1080p');
    expect(selectedVersion(detail, '2160p')?.file_id).toBe('2160p');
    expect(selectedVersion(detail, 'auto')?.file_id).toBe('2160p');
    expect(selectedVersion(detail, 'original')?.file_id).toBe('2160p');
    expect(selectedVersion(detail, null)?.file_id).toBe('2160p');
    const tooSharp = itemDetail({ versions: [at('2160p'), at('1080p')] });
    expect(selectedVersion(tooSharp, '480p')?.file_id).toBe('2160p');
  });

  it('takes the file with the HDR flag when any file has it, at the sharpest resolution', () => {
    const detail = itemDetail({
      versions: [at('1080p', { file_id: 'sdr' }), at('1080p', { file_id: 'hdr', hdr: true })],
    });
    expect(selectedVersion(detail)?.file_id).toBe('hdr');
  });

  it('takes the file whose audio is the best the title has, among equally sharp ones', () => {
    const detail = itemDetail({
      versions: [
        at('1080p', { file_id: 'plain', codec_audio: 'aac' }),
        at('1080p', { file_id: 'lossless', codec_audio: 'truehd' }),
      ],
    });
    expect(selectedVersion(detail)?.file_id).toBe('lossless');
    // A better codec on a track counts for the file that has it, but the file's own codec is what
    // is compared: none matches, so the sharpest (the first of equals) wins.
    const onTrack = itemDetail({
      versions: [
        at('1080p', { file_id: 'plain', codec_audio: 'aac' }),
        at('1080p', {
          file_id: 'tracks',
          codec_audio: 'ac3',
          audio_tracks: [{ default: true, codec: 'truehd' }],
        }),
      ],
    });
    expect(selectedVersion(onTrack)?.file_id).toBe('plain');
  });

  it('ranks 4K above 1080p, an unknown label below 480p, and ignores the case of a label', () => {
    expect(selectedVersion(itemDetail({ versions: [at('1080p'), at('4K')] }))?.file_id).toBe('4K');
    expect(selectedVersion(itemDetail({ versions: [at('weird'), at('480p')] }))?.file_id).toBe(
      '480p',
    );
    expect(selectedVersion(itemDetail({ versions: [at('1080p'), at('2160P')] }))?.file_id).toBe(
      '2160P',
    );
  });

  it('falls back to the sharpest file when none matches the best attributes', () => {
    const detail = itemDetail({ versions: [at('weird'), at('also weird')] });
    expect(selectedVersion(detail)?.file_id).toBe('weird');
  });
});

describe('selectedVersion with playback variants', () => {
  const standard = variantOf('std', [
    at('1080p', { file_id: 'std-hd' }),
    at('720p', { file_id: 'std-sd' }),
  ]);
  const theatrical = variantOf('theatrical', [at('2160p', { file_id: 'th-uhd' })], {
    edition_key: 'theatrical',
  });
  const extended = variantOf(
    'ext',
    [at('1080p', { file_id: 'ext-hd' }), at('720p', { file_id: 'ext-sd' })],
    { edition_key: 'extended', edition_raw: 'Extended Cut' },
    'ext-sd',
  );
  const versions = [
    at('1080p', { file_id: 'std-hd' }),
    at('720p', { file_id: 'std-sd' }),
    at('2160p', { file_id: 'th-uhd' }),
    at('1080p', { file_id: 'ext-hd' }),
    at('720p', { file_id: 'ext-sd' }),
  ];
  const withVariants = (extra: Partial<S['CatalogItemDetail']> = {}) =>
    itemDetail({ versions, playback_variants: [extended, theatrical, standard], ...extra });

  it('prefers the standard edition, then the theatrical one, then any other', () => {
    expect(selectedVersion(withVariants())?.file_id).toBe('std-hd');
    expect(
      selectedVersion(itemDetail({ versions, playback_variants: [extended, theatrical] }))?.file_id,
    ).toBe('th-uhd');
    expect(selectedVersion(itemDetail({ versions, playback_variants: [extended] }))?.file_id).toBe(
      'ext-sd',
    );
  });

  it('counts an edition named "Standard" or "Default" as the standard one', () => {
    const named = variantOf('named', [at('720p', { file_id: 'named-sd' })], {
      edition_key: 'standard',
    });
    const detail = itemDetail({
      versions: [at('720p', { file_id: 'named-sd' }), at('2160p', { file_id: 'th-uhd' })],
      playback_variants: [theatrical, named],
    });
    expect(selectedVersion(detail)?.file_id).toBe('named-sd');
    const word = variantOf('word', [at('720p', { file_id: 'word-sd' })], {
      edition_raw: 'Default',
    });
    expect(
      selectedVersion(
        itemDetail({
          versions: [at('720p', { file_id: 'word-sd' }), at('2160p', { file_id: 'th-uhd' })],
          playback_variants: [theatrical, word],
        }),
      )?.file_id,
    ).toBe('word-sd');
  });

  it("takes the profile's edition, and the part's default file of it", () => {
    expect(
      selectedVersion(withVariants({ effective_version_edition_key: 'extended' }))?.file_id,
    ).toBe('ext-sd');
  });

  it('takes the edition last played when the profile chose none', () => {
    const detail = withVariants({ user_data: rollup({ last_edition_key: 'theatrical' }) });
    expect(selectedVersion(detail)?.file_id).toBe('th-uhd');
  });

  it('takes the file last played within the candidate editions, before the default file', () => {
    const detail = withVariants({
      effective_version_edition_key: 'extended',
      user_data: rollup({ last_file_id: 'ext-hd' }),
    });
    expect(selectedVersion(detail)?.file_id).toBe('ext-hd');
    // A last file in an edition that is not a candidate does not count.
    const elsewhere = withVariants({ user_data: rollup({ last_file_id: 'ext-hd' }) });
    expect(selectedVersion(elsewhere)?.file_id).toBe('std-hd');
  });

  it('takes the best fit under the cap in an edition without a default file', () => {
    expect(selectedVersion(withVariants(), '720p')?.file_id).toBe('std-sd');
  });

  it('reads the first part of an edition by its part index', () => {
    const second = { part_index: 1, versions: [at('2160p', { file_id: 'part-2' })] };
    const first = { part_index: 0, versions: [at('720p', { file_id: 'part-1' })] };
    const split = variantOf('split', []);
    split.parts = [second, first];
    const detail = itemDetail({
      versions: [at('720p', { file_id: 'part-1' }), at('2160p', { file_id: 'part-2' })],
      playback_variants: [split],
    });
    expect(selectedVersion(detail)?.file_id).toBe('part-1');
  });
});

describe('sortByResolution', () => {
  it('lists the sharpest first and keeps equally sharp files in order', () => {
    const sorted = sortByResolution([
      at('720p'),
      at('1080p', { file_id: 'a' }),
      at('1080p', { file_id: 'b' }),
    ]);
    expect(sorted.map((one) => one.file_id)).toEqual(['a', 'b', '720p']);
  });
});

describe('versionPicker', () => {
  const standardLabel = 'Standard';
  const uhd = at('2160p');
  const hd = at('1080p');

  it('offers nothing for a title with one file', () => {
    expect(versionPicker(itemDetail({ versions: [hd] }), hd, standardLabel)).toEqual({});
  });

  it('offers the files, the sharpest first, for a title with several and no editions', () => {
    const picker = versionPicker(itemDetail({ versions: [hd, uhd] }), hd, standardLabel);
    expect(picker.editions).toBeUndefined();
    expect(picker.versions?.map((one) => one.file_id)).toEqual(['2160p', '1080p']);
  });

  const cut = (key: string, extra: Partial<S['PlaybackVariant']> = {}, files = [uhd, hd]) =>
    variantOf(key, files, { edition_key: key, ...extra });

  it('offers the editions, named from their raw name, their key or "Standard"', () => {
    const detail = itemDetail({
      versions: [uhd, hd, at('720p')],
      playback_variants: [
        variantOf('plain', [at('720p')]),
        cut('directors_cut'),
        cut('imax', {}, [hd]),
        cut('x', { edition_raw: ' Raw Name ' }, [hd]),
      ],
    });
    const picker = versionPicker(detail, hd, standardLabel);
    expect(picker.editions?.options.map((option) => option.label)).toEqual([
      'Standard',
      'Directors Cut',
      'IMAX',
      'Raw Name',
    ]);
  });

  it("names the current edition by the file selected, and lists that edition's files", () => {
    const detail = itemDetail({
      versions: [uhd, hd, at('720p')],
      playback_variants: [variantOf('plain', [at('720p')]), cut('extended')],
    });
    const picker = versionPicker(detail, hd, standardLabel);
    expect(picker.editions?.current.id).toBe('extended');
    expect(picker.versions?.map((one) => one.file_id)).toEqual(['2160p', '1080p']);
    const other = versionPicker(detail, at('720p'), standardLabel);
    expect(other.editions?.current.id).toBe('plain');
    // An edition of one file has no version pill.
    expect(other.versions).toBeUndefined();
  });

  it('chooses an edition by its default file', () => {
    const detail = itemDetail({
      versions: [uhd, hd, at('720p')],
      playback_variants: [
        variantOf('plain', [at('720p')]),
        variantOf('ext', [uhd, hd], { edition_key: 'extended' }, '1080p'),
      ],
    });
    const options = versionPicker(detail, hd, standardLabel).editions?.options;
    expect(options?.find((option) => option.id === 'ext')?.defaultVersion.file_id).toBe('1080p');
    expect(options?.find((option) => option.id === 'plain')?.defaultVersion.file_id).toBe('720p');
  });

  it('has no edition pill without at least one named edition, or when every name is the same', () => {
    const unnamed = itemDetail({
      versions: [uhd, hd],
      playback_variants: [variantOf('a', [uhd]), variantOf('b', [hd])],
    });
    const picker = versionPicker(unnamed, uhd, standardLabel);
    expect(picker.editions).toBeUndefined();
    expect(picker.versions).toHaveLength(2);
    const same = itemDetail({
      versions: [uhd, hd],
      playback_variants: [
        cut('extended', {}, [uhd]),
        cut('other', { edition_raw: 'EXTENDED' }, [hd]),
      ],
    });
    expect(versionPicker(same, uhd, standardLabel).editions).toBeUndefined();
  });

  it('skips an edition without a file', () => {
    const detail = itemDetail({
      versions: [uhd, hd],
      playback_variants: [variantOf('empty', []), cut('extended')],
    });
    expect(versionPicker(detail, uhd, standardLabel).editions).toBeUndefined();
  });
});

describe('selectedVersion: the details of the best fit', () => {
  it('takes the better audio among the sharpest files when every file is above the cap', () => {
    const detail = itemDetail({
      versions: [
        at('2160p', { file_id: 'plain', codec_audio: 'aac' }),
        at('2160p', { file_id: 'lossless', codec_audio: 'truehd' }),
      ],
    });
    expect(selectedVersion(detail, '720p')?.file_id).toBe('lossless');
  });

  it("counts a better codec on a track: the set's best audio then matches no file's own, so the sharpest wins", () => {
    const detail = itemDetail({
      versions: [
        at('1080p', { file_id: 'plain', codec_audio: 'aac' }),
        at('1080p', {
          file_id: 'tracked',
          codec_audio: 'eac3',
          audio_tracks: [{ default: true, codec: 'truehd' }],
        }),
      ],
    });
    // Without the tracks the best audio would be EAC3, which the second file has.
    expect(selectedVersion(detail)?.file_id).toBe('plain');
  });

  it('keeps the first of two equally ranked audio codecs', () => {
    const detail = itemDetail({
      versions: [
        at('1080p', { file_id: 'eac3', codec_audio: 'eac3_atmos' }),
        at('1080p', { file_id: 'truehd', codec_audio: 'truehd_atmos' }),
      ],
    });
    expect(selectedVersion(detail)?.file_id).toBe('eac3');
  });

  it('takes the sharpest file when none matches the best attributes, though it is not the first', () => {
    const detail = itemDetail({
      versions: [at('1080p', { file_id: 'hd', hdr: true }), at('2160p', { file_id: 'uhd' })],
    });
    expect(selectedVersion(detail)?.file_id).toBe('uhd');
  });
});

describe('selectedVersion: editions with playback variants', () => {
  const files = (...ids: string[]) => ids.map((id) => at('720p', { file_id: id }));
  const extended = variantOf('ext', files('ext'), { edition_key: 'extended' });
  const theatrical = variantOf('th', files('th'), { edition_key: 'theatrical' });

  it('ranks "Standard Edition" and "Theatrical Standard" as the standard edition', () => {
    const first = variantOf('s1', files('s1'), { edition_raw: 'Standard Edition' });
    expect(
      selectedVersion(
        itemDetail({ versions: files('ext', 's1'), playback_variants: [extended, first] }),
      )?.file_id,
    ).toBe('s1');
    const second = variantOf('s2', files('s2'), { edition_raw: 'Theatrical Standard' });
    expect(
      selectedVersion(
        itemDetail({ versions: files('th', 's2'), playback_variants: [theatrical, second] }),
      )?.file_id,
    ).toBe('s2');
  });

  it("takes the profile's edition before the one last played", () => {
    const detail = itemDetail({
      versions: files('ext', 'th'),
      playback_variants: [extended, theatrical],
      effective_version_edition_key: 'extended',
      user_data: rollup({ last_edition_key: 'theatrical' }),
    });
    expect(selectedVersion(detail)?.file_id).toBe('ext');
  });

  it("falls back to the title's files when no variant has a file", () => {
    const detail = itemDetail({
      versions: [at('720p', { file_id: 'sd' }), at('1080p', { file_id: 'hd' })],
      playback_variants: [variantOf('empty', [])],
    });
    expect(selectedVersion(detail)?.file_id).toBe('hd');
  });

  it('offers no edition pill when the editions differ by raw name only', () => {
    const detail = itemDetail({
      versions: [at('1080p', { file_id: 'a' }), at('720p', { file_id: 'b' })],
      playback_variants: [
        variantOf('a', [at('1080p', { file_id: 'a' })], { edition_raw: 'First cut' }),
        variantOf('b', [at('720p', { file_id: 'b' })], { edition_raw: 'Second cut' }),
      ],
    });
    const picker = versionPicker(detail, at('1080p', { file_id: 'a' }), 'Standard');
    expect(picker.editions).toBeUndefined();
    expect(picker.versions).toHaveLength(2);
  });

  it('lists the files of an edition sharpest-first whatever order its part has them in', () => {
    const hd = at('1080p', { file_id: 'hd' });
    const uhd = at('2160p', { file_id: 'uhd' });
    const detail = itemDetail({
      versions: [hd, uhd, at('720p', { file_id: 'sd' })],
      playback_variants: [
        variantOf('plain', [at('720p', { file_id: 'sd' })]),
        variantOf('ext', [hd, uhd], { edition_key: 'extended' }),
      ],
    });
    const picker = versionPicker(detail, uhd, 'Standard');
    expect(picker.versions?.map((one) => one.file_id)).toEqual(['uhd', 'hd']);
  });
});
