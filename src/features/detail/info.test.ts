import { describe, expect, it } from 'vitest';
import { translate, type Language } from '../../i18n';
import { episodeOf, fileVersion, itemDetail, rollup, seasonOf } from '../../test/detailFixtures';
import {
  defaultSeason,
  detailChips,
  detailKind,
  episodeCaptionTitle,
  episodeChips,
  episodeCode,
  episodeMetaLine,
  episodeProgress,
  episodeWatched,
  heroCredits,
  heroSynopsis,
  initials,
  isSpecials,
  kicker,
  orderSeasons,
  qualityBadges,
  ratingEntries,
  seasonCountText,
  seasonIndicator,
  seasonLabel,
  seasonProgress,
  seasonSubtitle,
  videoRangeLabel,
  type ItemDetail,
} from './info';
import { selectedVersion } from './versions';

const tFor =
  (lang: Language) =>
  (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(lang, key, params);
const t = tFor('en');

// The chips of a movie or episode page: the selected version supplies the runtime.
const movieChips = (detail: ItemDetail, tr: typeof t) =>
  detailChips(detail, [], tr, 0, selectedVersion(detail));
const episodeChipsOf = (detail: ItemDetail, lang: Language, tr: typeof t) =>
  episodeChips(detail, lang, tr, selectedVersion(detail));

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

describe('detailChips for a movie', () => {
  it('lists year, content rating and the runtime of the selected version, in that order', () => {
    const movie = itemDetail({
      year: 2017,
      content_rating: 'PG',
      runtime: 92,
      versions: [fileVersion({ duration: 6180 })],
    });
    expect(movieChips(movie, t)).toEqual(['2017', 'PG', '1h 43m']);
    expect(movieChips(movie, tFor('de'))).toEqual(['2017', 'PG', '1 Std. 43 Min.']);
  });

  it.each([
    [2580, '43m', '43 Min.'],
    [7200, '2h 0m', '2 Std. 0 Min.'],
    [3660, '1h 1m', '1 Std. 1 Min.'],
  ])('writes a %i second file as %s (de %s)', (duration, en, de) => {
    const movie = itemDetail({ versions: [fileVersion({ duration })] });
    expect(movieChips(movie, t).at(-1)).toBe(en);
    expect(movieChips(movie, tFor('de')).at(-1)).toBe(de);
  });

  it('takes the runtime of the item when the file has no duration, and leaves out what is missing', () => {
    const noFile = itemDetail({ versions: [], runtime: 92, content_rating: undefined });
    expect(movieChips(noFile, t)).toEqual(['2019', '1h 32m']);
    const bare = itemDetail({ versions: [], runtime: undefined, year: undefined });
    expect(movieChips(bare, t)).toEqual(['PG-13']);
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

/** The badges of the version the page would select (the web's rule, no resolution cap). */
const badgesOf = (detail: ReturnType<typeof itemDetail>) => qualityBadges(selectedVersion(detail));

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
    expect(badgesOf(movie)).toEqual(['2160P', 'HDR10', 'DTS']);
  });

  it('shows no range badge for SDR, and nothing for an item without a file', () => {
    const sdr = itemDetail({
      versions: [fileVersion({ resolution: '1080p', codec_audio: 'eac3' })],
    });
    expect(badgesOf(sdr)).toEqual(['1080P', 'EAC3']);
    expect(badgesOf(itemDetail({ versions: [] }))).toEqual([]);
  });

  it('describes the selected version only, not every file of the item', () => {
    const movie = itemDetail({
      versions: [
        fileVersion({ file_id: 'hd', resolution: '1080p', codec_audio: 'aac' }),
        fileVersion({ file_id: 'uhd', resolution: '2160p', hdr: true, codec_audio: 'truehd' }),
      ],
      user_data: rollup({ last_file_id: 'hd' }),
    });
    expect(badgesOf(movie)).toEqual(['1080P', 'AAC']);
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
    expect(badgesOf(atmos)).toEqual(['1080P', 'DD+ Atmos']);
    const compat = itemDetail({
      versions: [
        fileVersion({
          codec_audio: 'aac',
          audio_tracks: [audioTrack({ codec: 'aac', title: 'AAC 2.0 (from TrueHD Atmos)' })],
        }),
      ],
    });
    expect(badgesOf(compat)).toEqual(['1080P', 'AAC']);
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
    expect(badgesOf(best).at(-1)).toBe('TrueHD');
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
    expect(badgesOf(tie).at(-1)).toBe('DD+ Atmos');
  });

  it('gives a codec the web does not rank no badge', () => {
    const ac3 = itemDetail({
      versions: [fileVersion({ codec_audio: 'ac3', audio_tracks: [audioTrack({ codec: 'ac3' })] })],
    });
    expect(badgesOf(ac3)).toEqual(['1080P']);
  });

  it('reads the file codec when the version lists no tracks', () => {
    const movie = itemDetail({ versions: [fileVersion({ codec_audio: 'flac' })] });
    expect(badgesOf(movie)).toEqual(['1080P', 'FLAC']);
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
  it('orders the seasons by number, so the specials come first like on the web', () => {
    const seasons = [seasonOf(2), seasonOf(0), seasonOf(10), seasonOf(1)];
    expect(orderSeasons(seasons).map((s) => s.season_number)).toEqual([0, 1, 2, 10]);
  });

  it('orders a specials season whose number is not 0 by its number too', () => {
    const seasons = [seasonOf(3), seasonOf(1, { is_specials: true })];
    expect(orderSeasons(seasons).map((s) => s.season_number)).toEqual([1, 3]);
  });

  it('plays from the first numbered season when the server names no target, else the first', () => {
    const seasons = [seasonOf(2), seasonOf(0), seasonOf(1)];
    expect(defaultSeason(seasons)).toBe(1);
    expect(defaultSeason([seasonOf(0)])).toBe(0);
    expect(defaultSeason([seasonOf(0), seasonOf(5, { is_specials: true })])).toBe(0);
    expect(defaultSeason([])).toBeUndefined();
  });

  describe('labels', () => {
    it('numbers a season, and calls the specials Specials, in both languages', () => {
      expect(seasonLabel(seasonOf(1), t)).toBe('Season 1');
      expect(seasonLabel(seasonOf(0), t)).toBe('Specials');
      expect(seasonLabel(seasonOf(1, { is_specials: true }), tFor('de'))).toBe('Specials');
      expect(seasonLabel(seasonOf(2), tFor('de'))).toBe('Staffel 2');
    });

    it('uses the title the server gave a season, but not its placeholder', () => {
      expect(seasonLabel(seasonOf(1, { title: 'The Beginning' }), t)).toBe('The Beginning');
      expect(seasonLabel(seasonOf(1, { title: ' season 1 ' }), tFor('de'))).toBe('Staffel 1');
      expect(seasonLabel(seasonOf(1, { title: '' }), t)).toBe('Season 1');
      // A specials season keeps its label whatever its title says.
      expect(seasonLabel(seasonOf(0, { title: 'Extras' }), t)).toBe('Specials');
    });

    it('keeps the indicator numbered when the season has a name', () => {
      expect(seasonIndicator(seasonOf(2, { title: 'Rising' }), t)).toBe('Season 2');
      expect(seasonIndicator(seasonOf(0), t)).toBe('Specials');
    });

    it('has a subtitle only when the label differs from the translated indicator', () => {
      expect(seasonSubtitle(seasonOf(1, { title: 'The Beginning' }), t)).toBe('The Beginning');
      expect(seasonSubtitle(seasonOf(1), t)).toBeNull();
      expect(seasonSubtitle(seasonOf(0), t)).toBeNull();
      expect(seasonSubtitle(seasonOf(0, { title: 'Extras' }), t)).toBeNull();
    });

    it('adds no subtitle for a title the server already localised', () => {
      const de = tFor('de');
      expect(seasonSubtitle(seasonOf(2, { title: 'Staffel 2' }), de)).toBeNull();
      expect(seasonSubtitle(seasonOf(2, { title: 'Der Anfang' }), de)).toBe('Der Anfang');
      // Another language's wording is a real name in this one.
      expect(seasonSubtitle(seasonOf(2, { title: 'Staffel 2' }), t)).toBe('Staffel 2');
    });

    it('treats season 0 as the specials although is_specials is optional', () => {
      expect(isSpecials({ season_number: 0 })).toBe(true);
      expect(isSpecials({ season_number: 0, is_specials: false })).toBe(true);
      expect(isSpecials({ season_number: 1 })).toBe(false);
      expect(isSpecials({ season_number: 3, is_specials: true })).toBe(true);
      const bare = { ...seasonOf(0), is_specials: undefined };
      expect(defaultSeason([bare, seasonOf(1)])).toBe(1);
      expect(seasonLabel(bare, t)).toBe('Specials');
    });

    it('keeps a title that only starts like the placeholder', () => {
      const named = seasonOf(2, { title: 'Season 2: Rebirth' });
      expect(seasonLabel(named, t)).toBe('Season 2: Rebirth');
      expect(seasonSubtitle(named, t)).toBe('Season 2: Rebirth');
      expect(seasonLabel(seasonOf(2, { title: 'The Season 2' }), t)).toBe('The Season 2');
    });

    it('shows a season without a number as season 0, the type allows it on an item', () => {
      expect(seasonIndicator({}, t)).toBe('Season 0');
    });
  });

  describe('progress', () => {
    const started = (watched: number, count = 8, extra = {}) =>
      seasonOf(1, {
        episode_count: count,
        user_data: rollup({ watched_count: watched, ...extra }),
      });

    it('is a full bar for a watched season, whatever the counts say', () => {
      const played = seasonOf(1, { user_data: rollup({ played: true, watched_count: 1 }) });
      expect(seasonProgress(played)).toBe(1);
    });

    it('is the share of watched episodes for a season that was started', () => {
      expect(seasonProgress(started(2))).toBe(0.25);
      expect(seasonProgress(started(3, 12))).toBe(0.25);
      // An episode in progress alone starts the bar, at nothing.
      expect(seasonProgress(started(0, 8, { in_progress_count: 1 }))).toBe(0);
    });

    it('has no bar for a season nothing was watched of, or one without episodes', () => {
      expect(seasonProgress(seasonOf(1))).toBeNull();
      expect(seasonProgress(seasonOf(1, { user_data: rollup() }))).toBeNull();
      expect(seasonProgress(started(1, 0))).toBeNull();
    });

    it('never goes past full', () => {
      expect(seasonProgress(started(9, 8))).toBe(1);
    });

    it('counts the episodes, and the watched ones while the season is being watched', () => {
      expect(seasonCountText(seasonOf(1, { episode_count: 7 }), t)).toBe('7 episodes');
      expect(seasonCountText(seasonOf(1, { episode_count: 7 }), tFor('de'))).toBe('7 Folgen');
      expect(seasonCountText(seasonOf(1, { episode_count: 1 }), t)).toBe('1 episode');
      expect(seasonCountText(started(3, 7), t)).toBe('3 of 7 episodes');
      expect(seasonCountText(started(3, 7), tFor('de'))).toBe('3 von 7 Folgen');
      expect(seasonCountText(started(1, 1, { in_progress_count: 1 }), tFor('de'))).toBe(
        '1 von 1 Folge',
      );
      expect(seasonCountText(started(0, 7, { in_progress_count: 1 }), t)).toBe('0 of 7 episodes');
    });

    it('says only the count for a watched season', () => {
      const played = seasonOf(1, {
        episode_count: 7,
        user_data: rollup({ played: true, watched_count: 7 }),
      });
      expect(seasonCountText(played, t)).toBe('7 episodes');
    });
  });
});

describe('detailKind', () => {
  it('tells the layouts apart by the type, whatever its case', () => {
    expect(detailKind(itemDetail({ type: 'series' }))).toBe('series');
    expect(detailKind(itemDetail({ type: ' Season ' }))).toBe('season');
    expect(detailKind(itemDetail({ type: 'movie' }))).toBe('item');
    expect(detailKind(itemDetail({ type: ' Episode ' }))).toBe('episode');
  });
});

describe('detailChips: a season', () => {
  const season = (overrides = {}) =>
    itemDetail({
      type: 'season',
      season_number: 1,
      title: 'Season 1',
      air_date: '2008-01-20',
      episode_count: 7,
      content_rating: 'TV-MA',
      ...overrides,
    });

  it('lists the year it aired, the season and the number of episodes, no rating', () => {
    expect(detailChips(season(), [], t)).toEqual(['2008', 'Season 1', '7 episodes']);
    expect(detailChips(season(), [], tFor('de'))).toEqual(['2008', 'Staffel 1', '7 Folgen']);
  });

  it('keeps the numbered indicator when the season has a name', () => {
    expect(detailChips(season({ title: 'The Beginning' }), [], t)[1]).toBe('Season 1');
    expect(detailChips(season({ season_number: 0, is_specials: true }), [], t)[1]).toBe('Specials');
  });

  it('prefers the count the season carries to the number of loaded episodes', () => {
    expect(detailChips(season({ episode_count: 8 }), [], t, 5)[2]).toBe('8 episodes');
  });

  it('falls back to the loaded episodes, and leaves out what is missing', () => {
    const bare = season({ episode_count: undefined, air_date: undefined });
    expect(detailChips(bare, [], t, 5)).toEqual(['Season 1', '5 episodes']);
    expect(detailChips(bare, [], t)).toEqual(['Season 1']);
    expect(detailChips(season({ episode_count: 1 }), [], t)).toEqual([
      '2008',
      'Season 1',
      '1 episode',
    ]);
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
    badgesOf(itemDetail({ versions: [fileVersion({ codec_audio: '', audio_tracks: tracks })] })).at(
      -1,
    );

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
    expect(badgesOf(detail).at(-1)).toBe('DD+ Atmos');
  });
});

describe('the selected version in detail', () => {
  const at = (resolution: string, extra: object = {}) =>
    fileVersion({ file_id: resolution, resolution, ...extra });

  it('describes a version that is not the first one with its badges', () => {
    const detail = itemDetail({
      versions: [
        at('1080p', { codec_audio: 'aac' }),
        at('2160p', { codec_audio: 'truehd', hdr: true }),
      ],
    });
    expect(badgesOf(detail)).toEqual(['2160P', 'HDR', 'TrueHD']);
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
    expect(movieChips(detail, t)[0]).toBe('2007–2013');
  });

  it('has no year chip for a series without a year and without dates', () => {
    const detail = series({ year: undefined, content_rating: '18' });
    expect(movieChips(detail, t)).toEqual(['18']);
  });

  it('rounds a duration to the nearest minute', () => {
    const movie = itemDetail({ versions: [fileVersion({ duration: 5370 })] });
    expect(movieChips(movie, tFor('de')).at(-1)).toBe('1 Std. 30 Min.');
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

describe('an episode card caption', () => {
  const ep = (season: number, number: number, overrides = {}) =>
    episodeOf(season, number, { title: 'The Descent', ...overrides });
  const nbsp = ' ';

  it('writes the code with both numbers on two digits: S01F03 in German, S01E03 in English', () => {
    expect(episodeCode(ep(1, 3), tFor('de'))).toBe('S01F03');
    expect(episodeCode(ep(1, 3), t)).toBe('S01E03');
    expect(episodeCode(ep(12, 104), t)).toBe('S12E104');
    expect(episodeCode(ep(0, 9), t)).toBe('S00E09');
  });

  it('puts the title after the code, or shows the code alone without a title', () => {
    expect(episodeCaptionTitle(ep(1, 3), tFor('de'))).toBe('S01F03 · The Descent');
    expect(episodeCaptionTitle(ep(1, 3, { title: '' }), t)).toBe('S01E03');
    expect(episodeCaptionTitle(ep(1, 3, { title: '   ' }), t)).toBe('S01E03');
  });

  it('writes the air date and the runtime with two no-break spaces round the dot', () => {
    const both = ep(1, 1, { air_date: '2008-01-20', runtime: 58 });
    expect(episodeMetaLine(both, 'de', tFor('de'))).toBe(
      `20. Jan. 2008${nbsp}${nbsp}·${nbsp}${nbsp}58 Min.`,
    );
    expect(episodeMetaLine(both, 'en', t)).toBe(`Jan 20, 2008${nbsp}${nbsp}·${nbsp}${nbsp}58m`);
  });

  it('shows the runtime in hours and minutes when it is long', () => {
    expect(episodeMetaLine(ep(1, 1, { air_date: undefined, runtime: 125 }), 'de', tFor('de'))).toBe(
      '2 Std. 5 Min.',
    );
  });

  it('shows either part alone, and nothing when both are missing', () => {
    expect(episodeMetaLine(ep(1, 1, { air_date: '2008-01-20', runtime: 0 }), 'en', t)).toBe(
      'Jan 20, 2008',
    );
    expect(episodeMetaLine(ep(1, 1, { air_date: undefined, runtime: 58 }), 'en', t)).toBe('58m');
    expect(episodeMetaLine(ep(1, 1, { air_date: undefined, runtime: 0 }), 'en', t)).toBe('');
  });

  it('keeps the calendar day west of UTC, where local midnight is the day before', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const line = episodeMetaLine(ep(1, 1, { air_date: '2008-01-20', runtime: 0 }), 'en', t);
      expect(line).toBe('Jan 20, 2008');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('trims a date text it cannot read before showing it', () => {
    expect(episodeMetaLine(ep(1, 1, { air_date: ' soon ', runtime: 0 }), 'en', t)).toBe('soon');
  });

  it('shows a date text it cannot read as sent', () => {
    expect(episodeMetaLine(ep(1, 1, { air_date: '2008', runtime: 0 }), 'en', t)).toBe('2008');
  });
});

describe('episodeChips', () => {
  const episode = (overrides: Parameters<typeof itemDetail>[0] = {}) =>
    itemDetail({
      type: 'episode',
      runtime: 45,
      air_date: '2008-01-20',
      versions: [fileVersion({ duration: 3480 })],
      ...overrides,
    });

  it('shows the runtime of the selected version, then the air date in the medium format', () => {
    expect(episodeChipsOf(episode(), 'en', t)).toEqual(['58m', 'Jan 20, 2008']);
    expect(episodeChipsOf(episode(), 'de', tFor('de'))).toEqual(['58 Min.', '20. Jan. 2008']);
  });

  it('counts hours and minutes from an hour on', () => {
    const long = episode({ versions: [fileVersion({ duration: 3780 })] });
    expect(episodeChipsOf(long, 'en', t)[0]).toBe('1h 3m');
    expect(episodeChipsOf(long, 'de', tFor('de'))[0]).toBe('1 Std. 3 Min.');
  });

  it('rounds the version duration to whole minutes, as a movie does', () => {
    const half = episode({ versions: [fileVersion({ duration: 3510 })] });
    expect(episodeChipsOf(half, 'en', t)[0]).toBe('59m');
    expect(movieChips(itemDetail({ versions: [fileVersion({ duration: 3510 })] }), t)).toContain(
      '59m',
    );
  });

  it("falls back to the item's runtime when the version has no duration", () => {
    expect(episodeChipsOf(episode({ versions: [fileVersion({ duration: 0 })] }), 'en', t)).toEqual([
      '45m',
      'Jan 20, 2008',
    ]);
  });

  it('leaves out whichever of the two is missing', () => {
    expect(episodeChipsOf(episode({ air_date: undefined }), 'en', t)).toEqual(['58m']);
    expect(episodeChipsOf(episode({ runtime: undefined, versions: [] }), 'en', t)).toEqual([
      'Jan 20, 2008',
    ]);
    expect(
      episodeChipsOf(episode({ runtime: 0, versions: [], air_date: undefined }), 'en', t),
    ).toEqual([]);
  });

  it('adds no year or content rating: those are the movie and series chips', () => {
    expect(episodeChipsOf(episode({ year: 2008, content_rating: 'TV-14' }), 'en', t)).toEqual([
      '58m',
      'Jan 20, 2008',
    ]);
  });
});

describe('heroCredits: an episode', () => {
  const crew = [
    { name: 'Dana Director', job: 'Director' },
    { name: 'Wes Writer', job: 'Writer' },
  ];

  it('names the director and the writers and has no genres, where a movie lists them', () => {
    const episode = itemDetail({ type: 'episode', crew, genres: ['Drama', 'Crime'] });
    expect(heroCredits(episode, t)).toEqual({
      credits: [
        { label: 'Directed by', names: 'Dana Director' },
        { label: 'Written by', names: 'Wes Writer' },
      ],
      genres: [],
    });
    expect(heroCredits(itemDetail({ crew, genres: ['Drama', 'Crime'] }), t).genres).toEqual([
      'Drama',
      'Crime',
    ]);
  });
});

describe('heroSynopsis', () => {
  const episode = (overview?: string) => itemDetail({ type: 'episode', overview });

  it("shows the episode's own description", () => {
    expect(heroSynopsis(episode('Own.'), 'Series.', false)).toEqual({
      text: 'Own.',
      hidden: false,
      fromSeries: false,
    });
  });

  it('falls back to the series description when the episode has none, and never hides it', () => {
    expect(heroSynopsis(episode(undefined), 'Series.', false)).toEqual({
      text: 'Series.',
      hidden: false,
      fromSeries: true,
    });
    expect(heroSynopsis(episode(''), 'Series.', true)).toEqual({
      text: 'Series.',
      hidden: false,
      fromSeries: true,
    });
  });

  it("hides the episode's own description under spoiler protection", () => {
    expect(heroSynopsis(episode('Own.'), 'Series.', true)).toEqual({
      text: null,
      hidden: true,
      fromSeries: false,
    });
  });

  it('has nothing to show when neither has a description', () => {
    expect(heroSynopsis(episode(undefined), undefined, false)).toEqual({
      text: null,
      hidden: false,
      fromSeries: false,
    });
  });

  it('keeps a movie without a description empty: the series fallback is for episodes only', () => {
    expect(heroSynopsis(itemDetail({ overview: undefined }), 'Series.', false).text).toBeNull();
  });
});

describe('the chips and badges follow the version they are given', () => {
  const shortHd = fileVersion({ file_id: 'hd', resolution: '1080p', duration: 3600 });
  const longUhd = fileVersion({
    file_id: 'uhd',
    resolution: '2160p',
    duration: 7200,
    codec_audio: 'truehd',
  });
  const movie = itemDetail({ versions: [shortHd, longUhd], runtime: 99 });

  it("shows the given version's runtime on a movie and on an episode, not the default one's", () => {
    expect(detailChips(movie, [], t, 0, longUhd).at(-1)).toBe('2h 0m');
    expect(detailChips(movie, [], t, 0, shortHd).at(-1)).toBe('1h 0m');
    const episode = itemDetail({ type: 'episode', versions: [shortHd, longUhd] });
    expect(episodeChips(episode, 'en', t, longUhd)[0]).toBe('2h 0m');
    expect(episodeChips(episode, 'en', t, shortHd)[0]).toBe('1h 0m');
  });

  it("falls back to the item's own runtime when no version is given", () => {
    expect(detailChips(movie, [], t).at(-1)).toBe('1h 39m');
  });

  it('draws the badges of the given version, and none without one', () => {
    expect(qualityBadges(longUhd)).toEqual(['2160P', 'TrueHD']);
    expect(qualityBadges(shortHd)).toEqual(['1080P', 'AAC']);
    expect(qualityBadges(undefined)).toEqual([]);
  });
});
