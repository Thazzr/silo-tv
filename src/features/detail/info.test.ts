import { describe, expect, it } from 'vitest';
import { translate, type Language } from '../../i18n';
import { episodeOf, fileVersion, itemDetail, rollup, seasonOf } from '../../test/detailFixtures';
import {
  defaultSeason,
  detailChips,
  episodeProgress,
  episodeWatched,
  heroCredits,
  initials,
  kicker,
  orderSeasons,
  qualityBadges,
  ratingEntries,
  selectedVersion,
  videoRangeLabel,
} from './info';

const tFor =
  (lang: Language) =>
  (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(lang, key, params);
const t = tFor('en');

const video = (overrides: object = {}) => ({
  dv_config_present: false,
  dv_bl_compat_id_present: false,
  interlaced: false,
  ...overrides,
});

describe('kicker', () => {
  it('names a movie with its first studio, in the profile language', () => {
    const movie = itemDetail({ studios: ['Studio Ponoc', 'Second Studio'] });
    expect(kicker(movie, t)).toEqual({ type: 'Movie', name: 'Studio Ponoc' });
    expect(kicker(movie, tFor('de'))).toEqual({ type: 'Film', name: 'Studio Ponoc' });
  });

  it('names a series with its first network', () => {
    const series = itemDetail({ type: 'series', networks: ['AMC', 'Netflix'] });
    expect(kicker(series, t)).toEqual({ type: 'Series', name: 'AMC' });
    expect(kicker(series, tFor('de'))).toEqual({ type: 'Serie', name: 'AMC' });
  });

  it('has no second part for an item without a studio or network', () => {
    expect(kicker(itemDetail(), t).name).toBeNull();
    expect(kicker(itemDetail({ studios: [] }), t).name).toBeNull();
    expect(kicker(itemDetail({ type: 'series' }), t).name).toBeNull();
  });

  it("takes a movie's studio and a series' network, not the other way round", () => {
    expect(kicker(itemDetail({ networks: ['AMC'] }), t).name).toBeNull();
    expect(kicker(itemDetail({ type: 'series', studios: ['Studio'] }), t).name).toBeNull();
  });
});

describe('selectedVersion', () => {
  const sharp = fileVersion({ file_id: 'uhd', resolution: '2160p', hdr: true });
  const soft = fileVersion({ file_id: 'hd', resolution: '1080p' });

  it('is the sharpest version when nothing says otherwise', () => {
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

  it('is the version the server resolved for the profile when none was played', () => {
    const detail = itemDetail({
      versions: [sharp, soft],
      effective_version_resolution: '1080p',
      effective_version_hdr: false,
    });
    expect(selectedVersion(detail)?.file_id).toBe('hd');
  });

  it('chooses within the edition the profile picked', () => {
    const cut = fileVersion({ file_id: 'cut', resolution: '720p', edition_key: 'directors' });
    const detail = itemDetail({
      versions: [sharp, cut],
      effective_version_edition_key: 'directors',
    });
    expect(selectedVersion(detail)?.file_id).toBe('cut');
    // An edition no file has narrows nothing.
    const other = itemDetail({ versions: [sharp, cut], effective_version_edition_key: 'extended' });
    expect(selectedVersion(other)?.file_id).toBe('uhd');
  });
});

describe('detailChips for a movie', () => {
  it('lists year, content rating and the runtime of the selected version, in that order', () => {
    const movie = itemDetail({
      year: 2017,
      content_rating: 'PG',
      runtime: 92,
      versions: [fileVersion({ duration: 6180 })],
    });
    expect(detailChips(movie, [], t)).toEqual(['2017', 'PG', '1h 43m']);
    expect(detailChips(movie, [], tFor('de'))).toEqual(['2017', 'PG', '1 Std. 43 Min.']);
  });

  it.each([
    [2580, '43m', '43 Min.'],
    [7200, '2h 0m', '2 Std. 0 Min.'],
    [3660, '1h 1m', '1 Std. 1 Min.'],
  ])('writes a %i second file as %s (de %s)', (duration, en, de) => {
    const movie = itemDetail({ versions: [fileVersion({ duration })] });
    expect(detailChips(movie, [], t).at(-1)).toBe(en);
    expect(detailChips(movie, [], tFor('de')).at(-1)).toBe(de);
  });

  it('takes the runtime of the item when the file has no duration, and leaves out what is missing', () => {
    const noFile = itemDetail({ versions: [], runtime: 92, content_rating: undefined });
    expect(detailChips(noFile, [], t)).toEqual(['2019', '1h 32m']);
    const bare = itemDetail({ versions: [], runtime: undefined, year: undefined });
    expect(detailChips(bare, [], t)).toEqual(['PG-13']);
  });

  it('shows no genre and no season counts', () => {
    const chips = detailChips(itemDetail({ genres: ['Drama'] }), [seasonOf(1)], t);
    expect(chips.join(' ')).not.toContain('Drama');
    expect(chips.join(' ')).not.toMatch(/season|episode/);
  });
});

describe('detailChips for a series', () => {
  const seasons = [seasonOf(1, { episode_count: 7 }), seasonOf(2, { episode_count: 13 })];
  const series = (overrides = {}) =>
    itemDetail({
      type: 'series',
      year: 2008,
      first_air_date: '2008-01-20',
      last_air_date: '2013-09-29',
      content_rating: '18',
      runtime: 45,
      ...overrides,
    });

  it('lists the years, the content rating, the seasons and the episodes, in that order', () => {
    expect(detailChips(series(), seasons, t)).toEqual([
      '2008–2013',
      '18',
      '2 seasons',
      '20 episodes',
    ]);
    expect(detailChips(series(), seasons, tFor('de'))).toEqual([
      '2008–2013',
      '18',
      '2 Staffeln',
      '20 Folgen',
    ]);
  });

  it('writes one year when the series started and ended in the same year, or has no end', () => {
    expect(detailChips(series({ last_air_date: '2008-12-01' }), seasons, t)[0]).toBe('2008');
    expect(detailChips(series({ last_air_date: undefined }), seasons, t)[0]).toBe('2008');
  });

  it('starts at the item year without a first air date', () => {
    const chips = detailChips(series({ first_air_date: undefined, year: 2010 }), seasons, t);
    expect(chips[0]).toBe('2010–2013');
  });

  it('counts a single season and a single episode in the singular', () => {
    const chips = detailChips(series(), [seasonOf(1, { episode_count: 1 })], t);
    expect(chips.slice(2)).toEqual(['1 season', '1 episode']);
    expect(detailChips(series(), [seasonOf(1, { episode_count: 1 })], tFor('de')).slice(2)).toEqual(
      ['1 Staffel', '1 Folge'],
    );
  });

  it('counts the specials as a season, and sums the episodes of every season', () => {
    const chips = detailChips(series(), [seasonOf(0, { episode_count: 2 }), ...seasons], t);
    expect(chips.slice(2)).toEqual(['3 seasons', '22 episodes']);
  });

  it('has no season or episode chip until the season list is there, and no runtime or badge ever', () => {
    expect(detailChips(series(), [], t)).toEqual(['2008–2013', '18']);
    expect(detailChips(series(), seasons, t).join(' ')).not.toMatch(/\dm\b/);
  });
});

describe('videoRangeLabel', () => {
  it.each([
    [{ dolby_vision: 'Profile 5' }, 'DV'],
    [{ dv_profile: 8 }, 'DV'],
    [{ video_range_type: 'DOVIWithEL' }, 'DV'],
    [{ video_range_type: 'DOVIWithHDR10' }, 'DV HDR10'],
    [{ video_range_type: 'DOVIWithHDR10Plus' }, 'DV HDR10+'],
    [{ video_range_type: 'DOVIWithHLG' }, 'DV HLG'],
    [{ dv_profile: 8, hdr10_plus: true }, 'DV HDR10+'],
    [{ dv_profile: 8, color_transfer: 'smpte2084' }, 'DV HDR10'],
    [{ hdr10_plus: true }, 'HDR10+'],
    [{ video_range_type: 'HDR10Plus' }, 'HDR10+'],
    [{ video_range_type: 'HDR10' }, 'HDR10'],
    [{ color_transfer: 'SMPTE2084' }, 'HDR10'],
    [{ video_range_type: 'HLG' }, 'HLG'],
    [{ color_transfer: 'arib-std-b67' }, 'HLG'],
  ])('labels the track %j as %s', (track, label) => {
    expect(videoRangeLabel(fileVersion({ hdr: true, video_tracks: [video(track)] }))).toBe(label);
  });

  it('falls back to the version flag when no track names a range, and is empty for SDR', () => {
    expect(videoRangeLabel(fileVersion({ hdr: true, video_tracks: [video()] }))).toBe('HDR');
    expect(videoRangeLabel(fileVersion({ hdr: true }))).toBe('HDR');
    expect(videoRangeLabel(fileVersion({ hdr: false, video_tracks: [video()] }))).toBe('');
    expect(videoRangeLabel(fileVersion({ hdr: false }))).toBe('');
  });

  it('prefers what a track says over the flag, and joins the Dolby Vision of one track with the HDR of another', () => {
    expect(
      videoRangeLabel(fileVersion({ hdr: false, video_tracks: [video({ hdr10_plus: true })] })),
    ).toBe('HDR10+');
    const split = fileVersion({
      video_tracks: [video({ dv_profile: 5 }), video({ video_range_type: 'HDR10' })],
    });
    expect(videoRangeLabel(split)).toBe('DV HDR10');
  });

  it('takes the first HDR type a track names', () => {
    const tracks = [video({ video_range_type: 'HLG' }), video({ video_range_type: 'HDR10' })];
    expect(videoRangeLabel(fileVersion({ video_tracks: tracks }))).toBe('HLG');
  });
});

describe('qualityBadges', () => {
  const audioTrack = (overrides: object = {}) => ({ default: false, ...overrides });

  it('shows the resolution, the dynamic range and the audio of the selected version', () => {
    const movie = itemDetail({
      versions: [
        fileVersion({
          resolution: '2160p',
          hdr: true,
          video_tracks: [video({ video_range_type: 'HDR10' })],
          codec_audio: 'dts',
          audio_tracks: [audioTrack({ codec: 'dts' })],
        }),
      ],
    });
    expect(qualityBadges(movie)).toEqual(['2160P', 'HDR10', 'DTS']);
  });

  it('shows no range badge for SDR, and nothing for an item without a file', () => {
    const sdr = itemDetail({
      versions: [fileVersion({ resolution: '1080p', codec_audio: 'eac3' })],
    });
    expect(qualityBadges(sdr)).toEqual(['1080P', 'EAC3']);
    expect(qualityBadges(itemDetail({ versions: [] }))).toEqual([]);
  });

  it('describes the selected version only, not every file of the item', () => {
    const movie = itemDetail({
      versions: [
        fileVersion({ file_id: 'hd', resolution: '1080p', codec_audio: 'aac' }),
        fileVersion({ file_id: 'uhd', resolution: '2160p', hdr: true, codec_audio: 'truehd' }),
      ],
      user_data: rollup({ last_file_id: 'hd' }),
    });
    expect(qualityBadges(movie)).toEqual(['1080P', 'AAC']);
  });

  it('has none for a series, whatever its files or summary say', () => {
    const series = itemDetail({
      type: 'series',
      versions: [fileVersion({ resolution: '2160p', hdr: true })],
      overlay_summary: { resolution: '4K', hdr: 'HDR10', audio_channels: '5.1' },
    });
    expect(qualityBadges(series)).toEqual([]);
  });

  it('words the audio with the player rule: Atmos only on a codec that can carry it', () => {
    const atmos = itemDetail({
      versions: [
        fileVersion({
          codec_audio: 'eac3',
          audio_tracks: [
            audioTrack({ codec: 'eac3', profile: 'Dolby Digital Plus + Dolby Atmos' }),
          ],
        }),
      ],
    });
    expect(qualityBadges(atmos)).toEqual(['1080P', 'DD+ Atmos']);
    const compat = itemDetail({
      versions: [
        fileVersion({
          codec_audio: 'aac',
          audio_tracks: [audioTrack({ codec: 'aac', title: 'AAC 2.0 (from TrueHD Atmos)' })],
        }),
      ],
    });
    expect(qualityBadges(compat)).toEqual(['1080P', 'AAC']);
  });

  it('takes the best ranked audio track, and of equal ones the Atmos track', () => {
    const best = itemDetail({
      versions: [
        fileVersion({
          codec_audio: 'aac',
          audio_tracks: [audioTrack({ codec: 'aac' }), audioTrack({ codec: 'truehd' })],
        }),
      ],
    });
    expect(qualityBadges(best).at(-1)).toBe('TrueHD');
    const tie = itemDetail({
      versions: [
        fileVersion({
          codec_audio: 'eac3',
          audio_tracks: [
            audioTrack({ codec: 'eac3' }),
            audioTrack({ codec: 'eac3', title: 'Atmos 7.1' }),
          ],
        }),
      ],
    });
    expect(qualityBadges(tie).at(-1)).toBe('DD+ Atmos');
  });

  it('gives a codec the web does not rank no badge', () => {
    const ac3 = itemDetail({
      versions: [fileVersion({ codec_audio: 'ac3', audio_tracks: [audioTrack({ codec: 'ac3' })] })],
    });
    expect(qualityBadges(ac3)).toEqual(['1080P']);
  });

  it('reads the file codec when the version lists no tracks', () => {
    const movie = itemDetail({ versions: [fileVersion({ codec_audio: 'flac' })] });
    expect(qualityBadges(movie)).toEqual(['1080P', 'FLAC']);
  });
});

describe('ratingEntries', () => {
  it('shows every rating of the server, in its order, as name and value', () => {
    const detail = itemDetail({
      ratings: [
        { source: 'imdb', name: 'IMDb', score: 85, display: '8.5' },
        { source: 'tmdb', name: 'TMDB', score: 79, display: '7.9' },
        { source: 'rt', name: 'RT', score: 93, display: '93%' },
        { source: 'x', name: 'X', score: 1, display: '0.1' },
      ],
    });
    expect(ratingEntries(detail)).toEqual([
      { key: 'imdb', name: 'IMDb', value: '8.5' },
      { key: 'tmdb', name: 'TMDB', value: '7.9' },
      { key: 'rt', name: 'RT', value: '93%' },
      { key: 'x', name: 'X', value: '0.1' },
    ]);
    expect(ratingEntries(itemDetail())).toEqual([]);
  });

  it('skips a rating with nothing to show', () => {
    const detail = itemDetail({ ratings: [{ source: 'a', name: 'A', score: 1, display: '' }] });
    expect(ratingEntries(detail)).toEqual([]);
  });
});

describe('heroCredits', () => {
  const crew = [
    { name: 'Dana Director', job: 'Director' },
    { name: 'Dana Director', job: 'Director' },
    { name: 'Eli Editor', job: 'Editor' },
    { name: 'Finn Filmer', job: 'director' },
    { name: 'Gus Third', job: 'Director' },
    { name: 'Wen Writer', job: 'Writer' },
    { name: 'Sam Screen', job: ' Screenplay ' },
    { name: 'Wyn Third', job: 'Writer' },
    { name: 'Cory Creator', job: 'Creator' },
    { name: 'Cleo Creator', job: 'Creator' },
    { name: 'Cass Third', job: 'Creator' },
  ];

  it('names up to two directors and up to two writers of a movie, without duplicates', () => {
    expect(heroCredits(itemDetail({ crew }), t).credits).toEqual([
      { label: 'Directed by', names: 'Dana Director, Finn Filmer' },
      { label: 'Written by', names: 'Wen Writer, Sam Screen' },
    ]);
    expect(heroCredits(itemDetail({ crew }), tFor('de')).credits).toEqual([
      { label: 'Regie:', names: 'Dana Director, Finn Filmer' },
      { label: 'Drehbuch:', names: 'Wen Writer, Sam Screen' },
    ]);
  });

  it('names the creators of a series before its directors, two at most', () => {
    const series = itemDetail({ type: 'series', crew });
    expect(heroCredits(series, t).credits[0]).toEqual({
      label: 'Created by',
      names: 'Cory Creator, Cleo Creator',
    });
    expect(heroCredits(series, tFor('de')).credits[0]?.label).toBe('Erstellt von');
  });

  it('falls back to the directors of a series without creators, under the same label', () => {
    const series = itemDetail({ type: 'series', crew: crew.filter((p) => p.job !== 'Creator') });
    expect(heroCredits(series, t).credits[0]).toEqual({
      label: 'Created by',
      names: 'Dana Director, Finn Filmer',
    });
  });

  it('ignores creators on a movie', () => {
    const movie = itemDetail({ crew: crew.filter((p) => p.job === 'Creator') });
    expect(heroCredits(movie, t).credits).toEqual([]);
  });

  it('lists all genres, and leaves a piece out when the item has none of it', () => {
    expect(heroCredits(itemDetail(), t)).toEqual({
      credits: [],
      genres: ['Drama', 'Mystery', 'Thriller', 'Comedy'],
    });
    const writersOnly = itemDetail({ crew: [{ name: 'Wen Writer', job: 'Writer' }], genres: [] });
    expect(heroCredits(writersOnly, t)).toEqual({
      credits: [{ label: 'Written by', names: 'Wen Writer' }],
      genres: [],
    });
  });
});

describe('seasons', () => {
  it('orders numbered seasons first and the specials last', () => {
    const seasons = [seasonOf(2), seasonOf(0), seasonOf(10), seasonOf(1)];
    expect(orderSeasons(seasons).map((s) => s.season_number)).toEqual([1, 2, 10, 0]);
    expect(defaultSeason(seasons)).toBe(1);
    expect(defaultSeason([seasonOf(0)])).toBe(0);
    expect(defaultSeason([])).toBeUndefined();
  });
});

describe('episodes', () => {
  it('reports the progress of an episode that is partway and not played', () => {
    const half = episodeOf(1, 1, {
      user_data: rollup({ position_seconds: 1350, duration_seconds: 2700 }),
    });
    expect(episodeProgress(half)).toBe(0.5);
    expect(episodeProgress(episodeOf(1, 1))).toBeNull();
    // A watched episode that is being watched again keeps its bar (the Resume button's rule).
    expect(
      episodeProgress(
        episodeOf(1, 1, {
          user_data: rollup({ position_seconds: 360, duration_seconds: 2700, played: true }),
        }),
      ),
    ).toBeCloseTo(360 / 2700);
    // A watched episode whose position is at the end or at 0 has no bar.
    expect(
      episodeProgress(
        episodeOf(1, 1, {
          user_data: rollup({ position_seconds: 2698, duration_seconds: 2700, played: true }),
        }),
      ),
    ).toBeNull();
    expect(
      episodeProgress(
        episodeOf(1, 1, { user_data: rollup({ position_seconds: 0, played: true }) }),
      ),
    ).toBeNull();
    // Up to 30 s in is not a resume point: no bar, like no Resume button.
    expect(
      episodeProgress(
        episodeOf(1, 1, { user_data: rollup({ position_seconds: 30, duration_seconds: 2700 }) }),
      ),
    ).toBeNull();
    // Without a duration the runtime (45 min) stands in.
    expect(
      episodeProgress(episodeOf(1, 1, { user_data: rollup({ position_seconds: 1350 }) })),
    ).toBe(0.5);
  });

  it('marks only an episode that is played as watched', () => {
    expect(episodeWatched(episodeOf(1, 1, { user_data: rollup({ played: true }) }))).toBe(true);
    expect(episodeWatched(episodeOf(1, 1, { user_data: rollup() }))).toBe(false);
    expect(episodeWatched(episodeOf(1, 1))).toBe(false);
  });
});

describe('initials', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initials('Alex Black')).toBe('AB');
    expect(initials('Cher')).toBe('C');
    expect(initials('Mary Jane Watson')).toBe('MW');
    expect(initials('  ')).toBe('');
  });
});

describe('the audio badge ranking', () => {
  const track = (codec: string, overrides: object = {}) => ({
    default: false,
    codec,
    ...overrides,
  });
  // The badges of a version whose file codec says nothing, so only its tracks rank.
  const badge = (...tracks: ReturnType<typeof track>[]) =>
    qualityBadges(
      itemDetail({ versions: [fileVersion({ codec_audio: '', audio_tracks: tracks })] }),
    ).at(-1);

  it.each([
    ['Atmos', [track('truehd'), track('atmos')], 'Atmos'],
    ['TrueHD over DTS-HD', [track('dts-hd'), track('truehd')], 'TrueHD'],
    ['TrueHD over DTS', [track('dts'), track('truehd')], 'TrueHD'],
    ['DTS-HD over DTS', [track('dts'), track('dts-hd')], 'DTS-HD'],
    ['DTS:X over DTS', [track('dts'), track('dts:x')], 'DTS-HD'],
    ['DTS over FLAC', [track('flac'), track('dts')], 'DTS'],
    ['FLAC over EAC3', [track('eac3'), track('flac')], 'FLAC'],
    ['EAC3 over AAC', [track('aac'), track('eac3')], 'EAC3'],
    ['e-ac-3 over AAC', [track('aac'), track('e-ac-3')], 'EAC3'],
    ['a mixed-case TrueHD over DTS-HD', [track('dts-hd'), track('TrueHD')], 'TrueHD'],
  ])('ranks %s', (_name, tracks, expected) => {
    expect(badge(...tracks)).toBe(expected);
    expect(badge(...[...tracks].reverse())).toBe(expected);
  });

  it('lets the Atmos track win between equally ranked ones, whichever comes first', () => {
    const atmos = track('eac3', { profile: 'Dolby Digital Plus + Dolby Atmos' });
    expect(badge(track('eac3'), atmos)).toBe('DD+ Atmos');
    expect(badge(atmos, track('eac3'))).toBe('DD+ Atmos');
  });

  it('keeps the first of two Atmos tracks', () => {
    expect(badge(track('eac3_atmos'), track('truehd_atmos'))).toBe('DD+ Atmos');
    expect(badge(track('truehd_atmos'), track('eac3_atmos'))).toBe('TrueHD Atmos');
  });

  it('does not let Atmos evidence on a lower ranked codec beat a higher ranked one', () => {
    const atmos = track('eac3', { profile: 'Dolby Atmos' });
    expect(badge(track('truehd'), atmos)).toBe('TrueHD');
  });

  it('merges the file codec with its tracks: a plain file codec does not hide an Atmos track', () => {
    const detail = itemDetail({
      versions: [
        fileVersion({
          codec_audio: 'EAC3',
          audio_tracks: [track('eac3', { profile: 'Dolby Atmos' })],
        }),
      ],
    });
    expect(qualityBadges(detail).at(-1)).toBe('DD+ Atmos');
  });
});

describe('the selected version in detail', () => {
  const at = (resolution: string, extra: object = {}) =>
    fileVersion({ file_id: resolution, resolution, ...extra });

  it('takes the effective edition before the one last played', () => {
    const detail = itemDetail({
      versions: [at('1080p', { edition_key: 'b' }), at('720p', { edition_key: 'a' })],
      effective_version_edition_key: 'a',
      user_data: rollup({ last_edition_key: 'b' }),
    });
    expect(selectedVersion(detail)?.file_id).toBe('720p');
  });

  it('takes the edition last played when the server resolved none', () => {
    const detail = itemDetail({
      versions: [at('2160p', { edition_key: 'a' }), at('720p', { edition_key: 'b' })],
      user_data: rollup({ last_edition_key: 'b' }),
    });
    expect(selectedVersion(detail)?.file_id).toBe('720p');
  });

  it('matches the resolved version by its resolution and its HDR flag together', () => {
    const sameResolution = itemDetail({
      versions: [at('1080p', { file_id: 'hdr', hdr: true }), at('1080p', { file_id: 'sdr' })],
      effective_version_resolution: '1080p',
      effective_version_hdr: false,
    });
    expect(selectedVersion(sameResolution)?.file_id).toBe('sdr');
    const sameFlag = itemDetail({
      versions: [at('2160p'), at('1080p')],
      effective_version_resolution: '1080p',
      effective_version_hdr: false,
    });
    expect(selectedVersion(sameFlag)?.file_id).toBe('1080p');
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

  it('describes a version that is not the first one with its badges', () => {
    const detail = itemDetail({
      versions: [
        at('1080p', { codec_audio: 'aac' }),
        at('2160p', { codec_audio: 'truehd', hdr: true }),
      ],
    });
    expect(qualityBadges(detail)).toEqual(['2160P', 'HDR', 'TrueHD']);
  });
});

describe('details of the hero facts', () => {
  const series = (overrides = {}) =>
    itemDetail({ type: 'series', year: 2008, versions: [], ...overrides });

  it('gives a kicker with an empty studio no name', () => {
    expect(kicker(itemDetail({ studios: [''] }), t).name).toBeNull();
    expect(kicker(itemDetail({ type: 'series', networks: [''] }), t).name).toBeNull();
  });

  it('starts the year range at the first air date, even when the item year differs', () => {
    const detail = series({ first_air_date: '2007-05-01', last_air_date: '2013-01-01' });
    expect(detailChips(detail, [], t)[0]).toBe('2007–2013');
  });

  it('has no year chip for a series without a year and without dates', () => {
    const detail = series({ year: undefined, content_rating: '18' });
    expect(detailChips(detail, [], t)).toEqual(['18']);
  });

  it('rounds a duration to the nearest minute', () => {
    const movie = itemDetail({ versions: [fileVersion({ duration: 5370 })] });
    expect(detailChips(movie, [], tFor('de')).at(-1)).toBe('1 Std. 30 Min.');
  });

  it('adds no episodes for a season that does not say how many it has', () => {
    const chips = detailChips(series(), [seasonOf(1, { episode_count: undefined })], t);
    expect(chips).toEqual(['2008', 'PG-13', '1 season']);
  });

  it('counts Dolby Vision from any positive profile', () => {
    expect(videoRangeLabel(fileVersion({ video_tracks: [video({ dv_profile: 1 })] }))).toBe('DV');
    expect(videoRangeLabel(fileVersion({ video_tracks: [video({ dv_profile: 0 })] }))).toBe('');
  });

  it('skips a crew entry with an empty name and trims the others', () => {
    const detail = itemDetail({
      crew: [
        { name: '', job: 'Director' },
        { name: ' Anna ', job: 'Director' },
      ],
    });
    expect(heroCredits(detail, t).credits).toEqual([{ label: 'Directed by', names: 'Anna' }]);
  });

  it('shows only the creator of a series that has a creator and a director', () => {
    const detail = series({
      crew: [
        { name: 'Cory Creator', job: 'Creator' },
        { name: 'Dana Director', job: 'Director' },
      ],
    });
    expect(heroCredits(detail, t).credits).toEqual([
      { label: 'Created by', names: 'Cory Creator' },
    ]);
  });

  it.each([' Series ', 'SERIES'])('counts the type %j as a series', (type) => {
    const detail = itemDetail({
      type,
      networks: ['AMC'],
      studios: ['Studio'],
      crew: [{ name: 'C', job: 'Creator' }],
    });
    expect(kicker(detail, t)).toEqual({ type: 'Series', name: 'AMC' });
    expect(heroCredits(detail, t).credits[0]?.label).toBe('Created by');
  });
});
