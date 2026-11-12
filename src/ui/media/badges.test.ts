import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../i18n';
import { catalogItem } from '../../test/flowFixtures';
import {
  cardBadges,
  defaultBadgePrefs,
  parseBadgePrefs,
  primaryRatingText,
  resolveBadgePrefs,
  type BadgePosition,
  type BadgePrefs,
} from './badges';
import type { CatalogItem } from './cardInfo';

const en = {
  t: (key: MessageKey, params?: Record<string, string | number>) => translate('en', key, params),
  lang: 'en' as const,
};

const de = {
  t: (key: MessageKey, params?: Record<string, string | number>) => translate('de', key, params),
  lang: 'de' as const,
};

const POSITIONS: readonly BadgePosition[] = [
  'top-left',
  'bottom-left',
  'bottom-right',
  'left-edge',
  'right-edge',
];

/** A movie with the file data the default badges show. */
const movie = catalogItem({
  overlay_summary: { resolution: '1080p', hdr: 'DV', audio: 'EAC3', release_type: 'BluRay' },
});

const texts = (item: CatalogItem, prefs: BadgePrefs, position: BadgePosition) =>
  cardBadges(item, prefs, en)[position].map((badge) => badge.text);

/** A version 2 document that turns on exactly the given ids, at their default positions unless named. */
function only(
  items: Record<string, { position?: string; accentColor?: string; showIcon?: boolean }>,
  order: string[] = [],
): BadgePrefs {
  const off = Object.fromEntries(
    Object.keys(defaultBadgePrefs().items).map((id) => [id, { enabled: false }]),
  );
  const on = Object.fromEntries(
    Object.entries(items).map(([id, value]) => [id, { enabled: true, ...value }]),
  );
  return parseBadgePrefs({ version: 2, preset: 'classic', order, items: { ...off, ...on } })!;
}

describe('parseBadgePrefs', () => {
  it('reads a full version 2 document: enabled, position, accent and order', () => {
    const prefs = parseBadgePrefs({
      version: 2,
      preset: 'vibrant',
      order: ['hdr', 'resolution'],
      items: {
        resolution: { enabled: false, position: 'bottom-right' },
        rating_imdb: { enabled: true, position: 'right-edge', accentColor: '#112233' },
      },
    })!;
    expect(prefs.order).toEqual(['hdr', 'resolution']);
    expect(prefs.items.resolution).toEqual({ enabled: false, position: 'bottom-right' });
    expect(prefs.items.rating_imdb).toEqual({
      enabled: true,
      position: 'right-edge',
      accent: '#112233',
    });
  });

  it('keeps the registry default for what the document leaves out or gets wrong', () => {
    const prefs = parseBadgePrefs({
      version: 2,
      items: {
        resolution: { enabled: 'yes', position: 'middle' },
        rating_tmdb: { accentColor: 'teal' },
      },
    })!;
    expect(prefs.items.resolution).toEqual({ enabled: true, position: 'top-left' });
    // The accent that is not a colour leaves the badge's own.
    expect(prefs.items.rating_tmdb).toEqual({
      enabled: false,
      position: 'left-edge',
      accent: '#01b4e4',
    });
    expect(prefs.items.release_type).toEqual({ enabled: true, position: 'bottom-left' });
  });

  it('ignores ids and fields it does not know, and keeps them out of the order', () => {
    const prefs = parseBadgePrefs({
      version: 2,
      preset: 'plate',
      style: { size: 2 },
      order: ['hdr', 'imdb_top_250', 'invented', 7],
      items: {
        invented: { enabled: true, position: 'top-left', icon: 'x' },
        hdr: { image: 'a.webp' },
      },
    })!;
    expect(prefs.order).toEqual(['hdr']);
    expect(Object.keys(prefs.items)).not.toContain('invented');
    expect(Object.keys(prefs.items)).not.toContain('imdb_top_250');
    expect(prefs.items.hdr).toEqual({ enabled: true, position: 'top-left' });
  });

  it('moves a badge a document placed in the top-right to the right rail', () => {
    const prefs = parseBadgePrefs({ version: 2, items: { audio: { position: 'top-right' } } })!;
    expect(prefs.items.audio!.position).toBe('right-edge');
  });

  it('reads the same document as a JSON string, and the old flat map', () => {
    const asString = parseBadgePrefs(
      JSON.stringify({ version: 2, items: { year: { enabled: true } } }),
    )!;
    expect(asString.items.year!.enabled).toBe(true);
    const flat = parseBadgePrefs({ year: { enabled: true, position: 'bottom-right' } })!;
    expect(flat.items.year).toEqual({ enabled: true, position: 'bottom-right' });
  });

  it('is null for no document: null, undefined, text that is not JSON, an array or a number', () => {
    for (const raw of [null, undefined, 'not json', '[1]', [], 5, '']) {
      expect(parseBadgePrefs(raw)).toBeNull();
    }
  });
});

describe('resolveBadgePrefs', () => {
  const none = {
    profileDocument: null,
    profileEnabled: null,
    serverDefaults: undefined,
    serverEnabled: undefined,
  };

  it('falls back from the profile document to the server defaults to the registry', () => {
    const server = JSON.stringify({ version: 2, items: { resolution: { enabled: false } } });
    const profile = parseBadgePrefs({ version: 2, items: { audio: { enabled: false } } })!;
    // The server's document is used when the profile has none ...
    const inherited = resolveBadgePrefs({ ...none, serverDefaults: server })!;
    expect(inherited.items.resolution!.enabled).toBe(false);
    // ... an explicit profile document beats it ...
    const chosen = resolveBadgePrefs({
      ...none,
      profileDocument: profile,
      serverDefaults: server,
    })!;
    expect(chosen.items.resolution!.enabled).toBe(true);
    expect(chosen.items.audio!.enabled).toBe(false);
    // ... and without either the registry's own apply.
    expect(resolveBadgePrefs(none)).toEqual(defaultBadgePrefs());
  });

  it('shows no badges when the profile switched them off, even if the server has them on', () => {
    expect(resolveBadgePrefs({ ...none, profileEnabled: false, serverEnabled: true })).toBeNull();
  });

  it('inherits the server switch when the profile has not chosen, and lets an explicit "on" win', () => {
    expect(resolveBadgePrefs({ ...none, serverEnabled: false })).toBeNull();
    expect(
      resolveBadgePrefs({ ...none, profileEnabled: true, serverEnabled: false }),
    ).not.toBeNull();
    expect(resolveBadgePrefs({ ...none, serverEnabled: undefined })).not.toBeNull();
  });
});

describe('the registry', () => {
  it('draws the default badges of a movie: resolution, range and audio top left, the release bottom left', () => {
    const prefs = defaultBadgePrefs();
    expect(texts(movie, prefs, 'top-left')).toEqual(['1080p', 'DV', 'EAC3']);
    expect(texts(movie, prefs, 'bottom-left')).toEqual(['BluRay']);
    expect(texts(movie, prefs, 'bottom-right')).toEqual([]);
  });

  it('shows 2160p as 4K and leaves other resolutions as the server wrote them', () => {
    const prefs = defaultBadgePrefs();
    const uhd = catalogItem({ overlay_summary: { resolution: '2160p' } });
    expect(texts(uhd, prefs, 'top-left')).toEqual(['4K']);
    const sd = catalogItem({ overlay_summary: { resolution: '576p' } });
    expect(texts(sd, prefs, 'top-left')).toEqual(['576p']);
  });

  it('leaves out a badge the item has no data for', () => {
    const prefs = defaultBadgePrefs();
    expect(cardBadges(catalogItem(), prefs, en)['top-left']).toEqual([]);
    const partial = catalogItem({ overlay_summary: { audio: 'AAC', hdr: '  ' } });
    expect(texts(partial, prefs, 'top-left')).toEqual(['AAC']);
  });

  it('formats each optional badge the way the web does', () => {
    const item = catalogItem({
      runtime: 118,
      year: 1999,
      original_language: 'fr',
      studios: [' ', 'Gaumont'],
      networks: ['HBO'],
      content_rating: 'PG-13',
      advisory_age: 12,
      rating_imdb: 8.46,
      rating_tmdb: 7,
      rating_rt_critic: 92.6,
      rating_rt_audience: 88,
      show_status: 'Returning Series',
      overlay_summary: {
        multi_audio: true,
        multi_sub: true,
        container: 'mkv',
        video_codec: 'HEVC',
        audio_channels: '5.1',
        aspect_ratio: '2.39:1',
        edition: "Director's Cut",
      },
    });
    const textOf = (id: string) =>
      Object.values(cardBadges(item, only({ [id]: {} }), en))
        .flat()
        .map((badge) => badge.text);
    expect(textOf('runtime')).toEqual(['1h 58m']);
    expect(textOf('year')).toEqual(['1999']);
    expect(textOf('original_language')).toEqual(['French']);
    expect(textOf('studio')).toEqual(['Gaumont']);
    expect(textOf('network')).toEqual(['HBO']);
    expect(textOf('content_rating')).toEqual(['PG-13']);
    expect(textOf('advisory_age')).toEqual(['12+']);
    expect(textOf('rating_imdb')).toEqual(['IMDb 8.5']);
    expect(textOf('rating_tmdb')).toEqual(['TMDB 7.0']);
    expect(textOf('rating_rt')).toEqual(['RT 93%']);
    expect(textOf('rating_rt_audience')).toEqual(['RT Audience 88%']);
    expect(textOf('show_status')).toEqual(['Returning']);
    expect(textOf('multi_audio')).toEqual(['Multi-Audio']);
    expect(textOf('multi_sub')).toEqual(['CC']);
    expect(textOf('container')).toEqual(['mkv']);
    expect(textOf('video_codec')).toEqual(['HEVC']);
    expect(textOf('audio_channels')).toEqual(['5.1']);
    expect(textOf('aspect_ratio')).toEqual(['2.39:1']);
    expect(textOf('edition')).toEqual(["Director's Cut"]);
  });

  it('shows a show status it does not know as the server sent it, and a runtime under an hour', () => {
    const item = catalogItem({ runtime: 45, show_status: 'On Hiatus' });
    const all = cardBadges(item, only({ show_status: {}, runtime: {} }), en);
    expect(all['right-edge'].map((badge) => badge.text)).toEqual(['On Hiatus']);
    expect(all['bottom-left'].map((badge) => badge.text)).toEqual(['45m']);
  });

  it("tints a badge with the document's accent or its own", () => {
    const item = catalogItem({ rating_imdb: 8, rating_tmdb: 7, year: 2000 });
    const prefs = only({ rating_imdb: {}, rating_tmdb: { accentColor: '#abcdef' }, year: {} });
    const all = cardBadges(item, prefs, en);
    expect(all['left-edge'].map((badge) => badge.accent)).toEqual(['#f5c518', '#abcdef']);
    expect(all['bottom-left'][0]).not.toHaveProperty('accent');
  });
});

describe('cardBadges layout', () => {
  const rich = catalogItem({
    year: 2000,
    runtime: 100,
    original_language: 'de',
    rating_imdb: 8,
    rating_tmdb: 7,
    rating_rt_critic: 90,
    rating_rt_audience: 80,
    overlay_summary: {
      resolution: '1080p',
      hdr: 'HDR10',
      audio: 'AAC',
      audio_channels: '2.0',
      video_codec: 'AVC',
      container: 'mp4',
    },
  });

  it("holds at most three badges per corner, the first of the document's order", () => {
    const all = { resolution: {}, hdr: {}, audio: {}, audio_channels: {}, video_codec: {} };
    expect(texts(rich, only(all), 'top-left')).toEqual(['1080p', 'HDR10', 'AAC']);
    const ranked = only(all, ['video_codec', 'audio_channels', 'audio']);
    expect(texts(rich, ranked, 'top-left')).toEqual(['AVC', '2.0', 'AAC']);
  });

  it('holds four on an edge rail', () => {
    const prefs = only({
      rating_imdb: {},
      rating_tmdb: {},
      rating_rt: {},
      rating_rt_audience: {},
      year: { position: 'left-edge' },
    });
    expect(texts(rich, prefs, 'left-edge')).toEqual([
      'IMDb 8.0',
      'TMDB 7.0',
      'RT 90%',
      'RT Audience 80%',
    ]);
  });

  it('counts only badges that have data against the cap', () => {
    const prefs = only({ container: {}, edition: {}, year: {}, runtime: {} });
    // The edition has no data, so the three that do fill the corner.
    expect(texts(rich, prefs, 'bottom-left')).toEqual(['mp4', '2000', '1h 40m']);
  });

  it('puts nothing in the top-right: a badge placed there goes to the right rail', () => {
    const prefs = only({ resolution: { position: 'top-right' }, hdr: { position: 'top-right' } });
    const all = cardBadges(rich, prefs, en);
    expect(Object.keys(all).sort()).toEqual([...POSITIONS].sort());
    expect(all['right-edge'].map((badge) => badge.text)).toEqual(['1080p', 'HDR10']);
    expect(all['top-left']).toEqual([]);
  });

  it('shows a combined badge instead of the ones it covers', () => {
    const base = { resolution: {}, hdr: {}, audio: {}, resolution_hdr: {} };
    expect(texts(rich, only(base), 'top-left')).toEqual(['1080p HDR', 'AAC']);
    const wide = only({ ...base, resolution_hdr_audio: {} });
    expect(texts(rich, wide, 'top-left')).toEqual(['1080p HDR AAC']);
  });

  it('returns nothing for a disabled badge', () => {
    const prefs = only({});
    for (const position of POSITIONS) expect(texts(rich, prefs, position)).toEqual([]);
  });
});

describe("the web's value formats", () => {
  const resolutionOf = (resolution: string) =>
    texts(catalogItem({ overlay_summary: { resolution } }), defaultBadgePrefs(), 'top-left');

  it('labels resolutions like the web: 4K, 8K, a number with p kept, anything else upper-cased', () => {
    for (const value of ['2160p', '4k', 'UHD']) expect(resolutionOf(value)).toEqual(['4K']);
    for (const value of ['4320p', '8k']) expect(resolutionOf(value)).toEqual(['8K']);
    expect(resolutionOf('1080p')).toEqual(['1080p']);
    expect(resolutionOf('1080P')).toEqual(['1080p']);
    expect(resolutionOf('sd')).toEqual(['SD']);
    // A bare number is not a resolution name there.
    expect(resolutionOf('2160')).toEqual(['2160']);
    expect(resolutionOf('  ')).toEqual([]);
  });

  it('shortens the dynamic range in the combined badge: Dolby Vision is DV, HDR10+ stays, the rest is HDR', () => {
    const combined = (hdr: string) =>
      texts(
        catalogItem({ overlay_summary: { resolution: '2160p', hdr } }),
        only({ resolution_hdr: {} }),
        'top-left',
      );
    expect(combined('DV HDR10')).toEqual(['4K DV']);
    expect(combined('HDR10 DV')).toEqual(['4K DV']);
    expect(combined('DV HDR10+')).toEqual(['4K DV']);
    expect(combined('HDR10+')).toEqual(['4K HDR10+']);
    expect(combined('HDR10')).toEqual(['4K HDR']);
    expect(combined('HLG')).toEqual(['4K HDR']);
  });

  it('joins resolution, range and audio with single spaces and leaves out what is missing', () => {
    const all = (summary: object) =>
      texts(
        catalogItem({ overlay_summary: summary }),
        only({ resolution_hdr_audio: {} }),
        'top-left',
      );
    expect(all({ resolution: '2160p', audio: 'EAC3' })).toEqual(['4K EAC3']);
    expect(all({ resolution: '1080p', hdr: 'HDR10', audio: 'AAC' })).toEqual(['1080p HDR AAC']);
    expect(all({ audio: 'AAC' })).toEqual(['AAC']);
    expect(all({})).toEqual([]);
  });

  it('shows a rating of zero as the web does, and rounds a score to one decimal', () => {
    const imdb = (score: number) =>
      texts(catalogItem({ rating_imdb: score }), only({ rating_imdb: {} }), 'left-edge');
    expect(imdb(0)).toEqual(['IMDb 0.0']);
    expect(imdb(8.46)).toEqual(['IMDb 8.5']);
    expect(imdb(8.04)).toEqual(['IMDb 8.0']);
    // 8.45 is stored a hair below, so only rounding first gives the web's 8.5.
    expect(imdb(8.45)).toEqual(['IMDb 8.5']);
  });

  it('shows no age and no year for zero', () => {
    const item = catalogItem({ advisory_age: 0, year: 0 });
    const prefs = only({ advisory_age: {}, year: {} });
    for (const position of POSITIONS) expect(texts(item, prefs, position)).toEqual([]);
  });

  it("names the show status in the app language: the web's German words, and the US spelling", () => {
    const status = (show_status: string, context: typeof de | typeof en = de) =>
      cardBadges(catalogItem({ show_status }), only({ show_status: {} }), context)[
        'right-edge'
      ].map((badge) => badge.text);
    expect(status('Ended')).toEqual(['Beendet']);
    expect(status('Cancelled')).toEqual(['Abgesetzt']);
    expect(status('Canceled')).toEqual(['Abgesetzt']);
    expect(status('Returning Series')).toEqual(['Wird fortgesetzt']);
    expect(status('Upcoming')).toEqual(['Demnächst']);
    expect(status('Ended', en)).toEqual(['Ended']);
    expect(status('Canceled', en)).toEqual(['Cancelled']);
    // A name that happens to be a property of every object is no status.
    expect(status('constructor')).toEqual(['constructor']);
  });

  it('names Rotten Tomatoes audience and multi audio like the web, in German too', () => {
    const item = catalogItem({ rating_rt_audience: 71, overlay_summary: { multi_audio: true } });
    const all = cardBadges(item, only({ rating_rt_audience: {}, multi_audio: {} }), de);
    expect(all['left-edge'].map((badge) => badge.text)).toEqual(['RT-Publikum 71%']);
    expect(all['bottom-right'].map((badge) => badge.text)).toEqual(['Multi-Audio']);
  });
});

describe('what a document may carry', () => {
  it('keeps a valid accent in any letter case, and drops one that is not six hex digits', () => {
    const accentOf = (accentColor: string) =>
      parseBadgePrefs({ version: 2, items: { rating_imdb: { accentColor } } })!.items.rating_imdb!
        .accent;
    expect(accentOf('#A1B2C3')).toBe('#A1B2C3');
    expect(accentOf('#a1b2c3')).toBe('#a1b2c3');
    expect(accentOf('#12')).toBe('#f5c518');
    expect(accentOf('#zzzzzz')).toBe('#f5c518');
    expect(accentOf('#1234567')).toBe('#f5c518');
  });

  it('parses a document with null where an object belongs, without throwing, into the defaults', () => {
    expect(parseBadgePrefs({ version: 2, items: null })).toEqual(defaultBadgePrefs());
    expect(parseBadgePrefs({ resolution: null })).toEqual(defaultBadgePrefs());
    expect(parseBadgePrefs({ version: 2, items: { resolution: null } })).toEqual(
      defaultBadgePrefs(),
    );
  });

  it('reads items without a version or a preset as the flat map, and with a preset as version 2', () => {
    const wrapped = { items: { year: { enabled: true } } };
    expect(parseBadgePrefs(wrapped)!.items.year!.enabled).toBe(false);
    expect(parseBadgePrefs({ preset: 'classic', ...wrapped })!.items.year!.enabled).toBe(true);
    // A preset without an items map is not version 2 either.
    expect(
      parseBadgePrefs({ preset: 'classic', year: { enabled: true } })!.items.year!.enabled,
    ).toBe(true);
  });

  it('takes "enabled" only as a boolean', () => {
    const prefs = parseBadgePrefs({
      version: 2,
      items: { resolution: { enabled: 0 }, year: { enabled: 'true' }, hdr: { enabled: false } },
    })!;
    expect(prefs.items.resolution!.enabled).toBe(true);
    expect(prefs.items.year!.enabled).toBe(false);
    expect(prefs.items.hdr!.enabled).toBe(false);
  });

  it('holds four on the right rail as well', () => {
    const prefs = only({
      rating_imdb: { position: 'right-edge' },
      rating_tmdb: { position: 'right-edge' },
      rating_rt: { position: 'right-edge' },
      rating_rt_audience: { position: 'right-edge' },
      year: { position: 'right-edge' },
    });
    const item = catalogItem({
      year: 2000,
      rating_imdb: 1,
      rating_tmdb: 2,
      rating_rt_critic: 3,
      rating_rt_audience: 4,
    });
    expect(texts(item, prefs, 'right-edge')).toHaveLength(4);
  });
});

describe('badge glyphs', () => {
  const glyphsOf = (item: CatalogItem, items: Record<string, { showIcon?: boolean }>) =>
    Object.fromEntries(
      Object.values(cardBadges(item, only(items), en))
        .flat()
        .map((badge) => [badge.id, badge.glyph ?? null]),
    );

  it('gives a badge its glyph only when the document asks for it', () => {
    const item = catalogItem({ overlay_summary: { resolution: '1080p', audio: 'AAC' } });
    expect(glyphsOf(item, { resolution: {}, audio: {} })).toEqual({
      resolution: null,
      audio: null,
    });
    expect(glyphsOf(item, { resolution: { showIcon: true }, audio: { showIcon: false } })).toEqual({
      resolution: 'monitor',
      audio: null,
    });
  });

  it("maps the web's generic icon ids to glyphs", () => {
    const item = catalogItem({
      runtime: 90,
      year: 2000,
      original_language: 'fr',
      studios: ['S'],
      networks: ['N'],
      content_rating: 'R',
      advisory_age: 12,
      show_status: 'Ended',
      rating_imdb: 5,
      overlay_summary: {
        audio: 'AAC',
        audio_channels: '5.1',
        video_codec: 'HEVC',
        aspect_ratio: '2.39:1',
        multi_audio: true,
        multi_sub: true,
        container: 'mkv',
        resolution: '1080p',
        hdr: 'HDR10',
      },
    });
    const on = { showIcon: true };
    // A corner holds three badges, so the ids are asked for in groups.
    const groups = [
      ['resolution', 'hdr', 'audio'],
      ['audio_channels', 'video_codec'],
      ['aspect_ratio', 'multi_audio', 'multi_sub'],
      ['content_rating', 'advisory_age', 'studio'],
      ['network', 'show_status', 'rating_imdb'],
      ['container', 'runtime', 'year'],
      ['original_language'],
    ];
    const glyphs = Object.assign(
      {},
      ...groups.map((ids) => glyphsOf(item, Object.fromEntries(ids.map((id) => [id, on])))),
    );
    expect(glyphs).toEqual({
      resolution: 'monitor',
      hdr: null,
      audio: 'volume',
      audio_channels: 'volume',
      video_codec: 'film',
      aspect_ratio: 'layout',
      multi_audio: 'languages',
      multi_sub: 'subtitles',
      container: null,
      content_rating: 'shield',
      advisory_age: 'users',
      runtime: 'clock',
      year: null,
      original_language: 'globe',
      studio: 'building',
      network: 'tv',
      show_status: 'tv',
      rating_imdb: null,
    });
  });

  it('draws no glyph where the web draws a brand wordmark', () => {
    const on = { showIcon: true };
    const atmos = catalogItem({
      overlay_summary: { audio: 'Atmos', video_codec: 'AV1', hdr: 'DV' },
    });
    expect(glyphsOf(atmos, { audio: on, video_codec: on, hdr: on })).toEqual({
      audio: null,
      video_codec: null,
      hdr: null,
    });
    const combined = catalogItem({ overlay_summary: { resolution: '1080p', hdr: 'DV' } });
    expect(glyphsOf(combined, { resolution_hdr: on })).toEqual({ resolution_hdr: null });
  });
});

describe('glyphs and the preset', () => {
  const item = catalogItem({ overlay_summary: { resolution: '1080p', audio: 'AAC' } });
  const glyphs = (document: object) =>
    Object.fromEntries(
      Object.values(cardBadges(item, parseBadgePrefs(document)!, en))
        .flat()
        .map((badge) => [badge.id, badge.glyph ?? null]),
    );
  const withPreset = (preset: unknown, items: object = {}) => ({ version: 2, preset, items });

  it('draws glyphs for the presets that prefer them, without any showIcon on the items', () => {
    for (const preset of ['pill', 'vibrant', 'plate']) {
      expect(glyphs(withPreset(preset))).toEqual({ resolution: 'monitor', audio: 'volume' });
    }
  });

  it('draws none for the presets that do not, for an unknown preset and for a missing one', () => {
    for (const preset of ['classic', 'minimal', 'square', 'band', 'invented', 7]) {
      expect(glyphs(withPreset(preset))).toEqual({ resolution: null, audio: null });
    }
    expect(glyphs({ version: 2, items: {} })).toEqual({ resolution: null, audio: null });
  });

  it("lets an item's showIcon beat the preset either way", () => {
    expect(glyphs(withPreset('pill', { resolution: { showIcon: false } }))).toEqual({
      resolution: null,
      audio: 'volume',
    });
    expect(glyphs(withPreset('classic', { resolution: { showIcon: true } }))).toEqual({
      resolution: 'monitor',
      audio: null,
    });
  });

  it("draws the glyphs of the real server's defaults: pill, no showIcon, wordmark and release without one", () => {
    const real = {
      version: 2,
      preset: 'pill',
      order: [],
      items: {
        resolution: { enabled: true, position: 'top-left' },
        hdr: { enabled: true, position: 'top-left' },
        audio: { enabled: true, position: 'top-left' },
        release_type: { enabled: true, position: 'bottom-left' },
      },
    };
    const full = catalogItem({
      overlay_summary: { resolution: '1080p', hdr: 'HDR10', audio: 'EAC3', release_type: 'BluRay' },
    });
    const all = cardBadges(full, parseBadgePrefs(real)!, en);
    expect(all['top-left'].map((badge) => [badge.text, badge.glyph ?? null])).toEqual([
      ['1080p', 'monitor'],
      ['HDR10', null],
      ['EAC3', 'volume'],
    ]);
    expect(all['bottom-left'].map((badge) => badge.glyph ?? null)).toEqual([null]);
  });
});

describe('primaryRatingText', () => {
  it('names the first source the item has a score for, as text', () => {
    expect(primaryRatingText(catalogItem({ rating_tmdb: 7 }), en)).toBe('TMDB 7.0');
    expect(primaryRatingText(catalogItem({ rating_tmdb: 7, rating_imdb: 8.14 }), en)).toBe(
      'IMDb 8.1',
    );
    expect(
      primaryRatingText(catalogItem({ rating_rt_critic: 91, rating_rt_audience: 80 }), en),
    ).toBe('RT 91%');
    expect(primaryRatingText(catalogItem({ rating_rt_audience: 80 }), de)).toBe(
      `${de.t('card.badge.rtAudience')} 80%`,
    );
  });

  it('is null without any score', () => {
    expect(primaryRatingText(catalogItem(), en)).toBeNull();
  });

  it('does not depend on which rating badges the profile turned on', () => {
    // The default document shows none of the rating badges; the text line still names one.
    expect(texts(catalogItem({ rating_tmdb: 7 }), defaultBadgePrefs(), 'left-edge')).toEqual([]);
    expect(primaryRatingText(catalogItem({ rating_tmdb: 7 }), en)).toBe('TMDB 7.0');
  });
});
