import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { episodeOf, fileVersion, itemDetail, rollup, seasonOf } from '../../test/detailFixtures';
import {
  creditLine,
  defaultSeason,
  episodeProgress,
  episodeWatched,
  initials,
  metaLine,
  orderSeasons,
  qualityBadges,
  ratingEntries,
  resumePoint,
} from './info';

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params);

describe('resumePoint', () => {
  it('is null at or below 30 s and the position past it', () => {
    expect(resumePoint({ position_seconds: 30, duration_seconds: 5400 })).toBeNull();
    expect(resumePoint({ position_seconds: 31, duration_seconds: 5400 })).toBe(31);
    expect(resumePoint({ position_seconds: 600.9, duration_seconds: 5400 })).toBe(600);
  });

  it('is null within 5 s of the end', () => {
    expect(resumePoint({ position_seconds: 5395, duration_seconds: 5400 })).toBeNull();
    expect(resumePoint({ position_seconds: 5394, duration_seconds: 5400 })).toBe(5394);
  });

  it('measures the end by the fallback runtime when the state has no duration', () => {
    expect(resumePoint({ position_seconds: 2398 }, 2400)).toBeNull();
    expect(resumePoint({ position_seconds: 1200 }, 2400)).toBe(1200);
    expect(resumePoint({ position_seconds: 1200 })).toBe(1200);
  });

  it('resumes a rewatch that stopped partway although the server counts the item played', () => {
    expect(
      resumePoint({ position_seconds: 900, duration_seconds: 5400, ...{ played: true } }),
    ).toBe(900);
  });

  it('is null without a watch state', () => {
    expect(resumePoint(undefined)).toBeNull();
    expect(resumePoint({})).toBeNull();
  });
});

describe('metaLine', () => {
  it('joins year, runtime, rating and the first three genres', () => {
    expect(metaLine(itemDetail(), t)).toBe(
      '2019 · 1 h 32 min · PG-13 · Drama · Mystery · Thriller',
    );
  });

  it('names the seasons of a series instead of a runtime, and leaves out what is missing', () => {
    const series = itemDetail({
      type: 'series',
      season_count: 3,
      runtime: 45,
      content_rating: undefined,
      genres: [],
    });
    expect(metaLine(series, t)).toBe('2019 · 3 seasons');
    expect(metaLine({ ...series, season_count: 1 }, t)).toBe('2019 · 1 season');
  });
});

describe('ratingEntries', () => {
  it('shows the server ratings as name and display, three at most', () => {
    const detail = itemDetail({
      ratings: [
        { source: 'imdb', name: 'IMDb', score: 85, display: '8.5' },
        { source: 'tmdb', name: 'TMDB', score: 79, display: '7.9' },
        { source: 'rt', name: 'RT', score: 93, display: '93%' },
        { source: 'x', name: 'X', score: 1, display: '0.1' },
      ],
    });
    expect(ratingEntries(detail).map((r) => r.text)).toEqual(['IMDb 8.5', 'TMDB 7.9', 'RT 93%']);
    expect(ratingEntries(itemDetail())).toEqual([]);
  });
});

describe('creditLine', () => {
  const crew = [
    { name: 'Dana Director', job: 'Director' },
    { name: 'Dana Director', job: 'Director' },
    { name: 'Eli Editor', job: 'Editor' },
    { name: 'Finn Filmer', job: 'director' },
    { name: 'Gus Third', job: 'Director' },
  ];
  const cast = [
    { name: 'Cleo Cast', character: 'A', order: 2 },
    { name: 'Abe Actor', character: 'B', order: 0 },
    { name: 'Bea Billed', character: 'C', order: 1 },
    { name: 'Dot Fourth', character: 'D', order: 3 },
  ];

  it('names up to two directors for a movie, without duplicates', () => {
    expect(creditLine(itemDetail({ crew, cast }), t)).toBe(
      'Directed by Dana Director, Finn Filmer',
    );
  });

  it('names the first three of the cast, in billing order, for a series', () => {
    expect(creditLine(itemDetail({ type: 'series', crew, cast }), t)).toBe(
      'Starring Abe Actor, Bea Billed, Cleo Cast',
    );
  });

  it('falls back to the cast for a movie without a director and is empty without names', () => {
    expect(creditLine(itemDetail({ cast }), t)).toBe('Starring Abe Actor, Bea Billed, Cleo Cast');
    expect(creditLine(itemDetail(), t)).toBe('');
  });
});

describe('qualityBadges', () => {
  it('shows nothing a file does not have', () => {
    expect(qualityBadges(itemDetail())).toEqual([]);
  });

  it('shows 4K from the resolution or the picture size', () => {
    expect(qualityBadges(itemDetail({ versions: [fileVersion({ resolution: '2160p' })] }))).toEqual(
      ['4K'],
    );
    const bySize = fileVersion({
      resolution: 'unknown',
      video_tracks: [
        {
          dv_config_present: false,
          dv_bl_compat_id_present: false,
          interlaced: false,
          width: 3840,
        },
      ],
    });
    expect(qualityBadges(itemDetail({ versions: [bySize] }))).toEqual(['4K']);
  });

  it('tells Dolby Vision, HDR10+, HDR10 and a plain HDR flag apart', () => {
    const track = { dv_config_present: false, dv_bl_compat_id_present: false, interlaced: false };
    const badges = (video: object, hdr = true) =>
      qualityBadges(
        itemDetail({
          versions: [fileVersion({ hdr, video_tracks: [{ ...track, ...video }] })],
        }),
      );
    expect(badges({ dv_config_present: true, dv_profile: 8 })).toEqual(['Dolby Vision']);
    expect(badges({ hdr10_plus: true })).toEqual(['HDR10+']);
    expect(badges({ video_range_type: 'HDR10' })).toEqual(['HDR10']);
    expect(badges({ color_transfer: 'smpte2084' })).toEqual(['HDR10']);
    expect(badges({})).toEqual(['HDR']);
    expect(badges({}, false)).toEqual([]);
  });

  it('gives no 4K badge to a 1080p file', () => {
    const hd = fileVersion({
      resolution: '1080p',
      video_tracks: [
        {
          dv_config_present: false,
          dv_bl_compat_id_present: false,
          interlaced: false,
          width: 1920,
          height: 1080,
        },
      ],
    });
    expect(qualityBadges(itemDetail({ versions: [hd] }))).toEqual([]);
  });

  it('tells Atmos from a plain E-AC-3 track', () => {
    const version = (audio: object) =>
      itemDetail({ versions: [fileVersion({ audio_tracks: [{ default: true, ...audio }] })] });
    expect(
      qualityBadges(version({ codec: 'eac3', profile: 'Dolby Digital Plus', channels: 2 })),
    ).toEqual([]);
    expect(
      qualityBadges(
        version({ codec: 'eac3', profile: 'Dolby Digital Plus + Dolby Atmos', channels: 2 }),
      ),
    ).toEqual(['Dolby Atmos']);
    expect(qualityBadges(version({ codec: 'eac3', profile: 'E-AC-3 JOC', channels: 2 }))).toEqual([
      'Dolby Atmos',
    ]);
  });

  it('shows Dolby Atmos, 5.1 and 7.1 from the audio tracks', () => {
    const version = (audio: object) =>
      itemDetail({ versions: [fileVersion({ audio_tracks: [{ default: true, ...audio }] })] });
    expect(qualityBadges(version({ channels: 6 }))).toEqual(['5.1']);
    expect(qualityBadges(version({ layout: '7.1' }))).toEqual(['7.1']);
    expect(qualityBadges(version({ profile: 'Dolby TrueHD + Dolby Atmos', channels: 8 }))).toEqual([
      'Dolby Atmos',
      '7.1',
    ]);
    expect(qualityBadges(version({ channels: 2 }))).toEqual([]);
  });

  it('draws them in a fixed order and combines the versions of an item', () => {
    const detail = itemDetail({
      versions: [
        fileVersion({ file_id: 'a', audio_tracks: [{ default: true, channels: 6 }] }),
        fileVersion({
          file_id: 'b',
          resolution: '2160p',
          hdr: true,
          video_tracks: [
            { dv_config_present: true, dv_bl_compat_id_present: false, interlaced: false },
          ],
          audio_tracks: [{ default: true, profile: 'Atmos' }],
        }),
      ],
    });
    expect(qualityBadges(detail)).toEqual(['4K', 'Dolby Vision', 'Dolby Atmos', '5.1']);
  });

  it('uses the best-file summary of a series, which has no versions of its own', () => {
    const series = itemDetail({
      type: 'series',
      versions: [],
      overlay_summary: { resolution: '4K', hdr: 'HDR10', audio_channels: '5.1' },
    });
    expect(qualityBadges(series)).toEqual(['4K', 'HDR10', '5.1']);
    expect(qualityBadges({ ...series, overlay_summary: { resolution: '1080p' } })).toEqual([]);
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
