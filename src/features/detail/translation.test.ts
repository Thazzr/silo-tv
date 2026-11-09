import { describe, expect, it } from 'vitest';
import { episodeOf, itemDetail, seasonOf } from '../../test/detailFixtures';
import {
  REREAD_DELAYS_S,
  itemMissing,
  pageTargets,
  seasonMissing,
  translationMode,
  type MetadataAICapability,
} from './translation';

const capability = (overrides: Partial<MetadataAICapability> = {}): MetadataAICapability => ({
  allowed: true,
  on_view: 'button',
  revision: 'r1',
  state: 'available',
  ...overrides,
});

describe('translationMode', () => {
  it('is button or auto when the server offers it and says so', () => {
    expect(translationMode(capability({ on_view: 'button' }))).toBe('button');
    expect(translationMode(capability({ on_view: 'auto' }))).toBe('auto');
  });

  it.each([
    ['an unknown mode', capability({ on_view: 'sometimes' })],
    ['the off mode', capability({ on_view: 'off' })],
    ['a refused principal', capability({ allowed: false })],
    ['a disabled capability', capability({ state: 'disabled' })],
    ['an unsupported capability', capability({ state: 'unsupported' })],
    ['a capability that is not configured', capability({ state: 'not_configured' })],
    ['no answer', undefined],
    ['a failed read', null],
  ])('is off for %s', (_name, document) => {
    expect(translationMode(document)).toBe('off');
  });
});

describe('REREAD_DELAYS_S', () => {
  it('is the exact schedule and adds up to 45 seconds', () => {
    expect(REREAD_DELAYS_S).toEqual([1, 2, 2, 3, 3, 4, 5, 5, 5, 5, 5, 5]);
    expect(REREAD_DELAYS_S.reduce((a, b) => a + b, 0)).toBe(45);
  });
});

describe('what is still missing', () => {
  it('an item misses its description only in the very language that is pending', () => {
    expect(itemMissing(itemDetail({ pending_translation_language: 'de' }), 'de')).toBe(true);
    expect(itemMissing(itemDetail({ pending_translation_language: 'fr' }), 'de')).toBe(false);
    expect(itemMissing(itemDetail(), 'de')).toBe(false);
    expect(itemMissing(undefined, 'de')).toBe(false);
  });

  it('a season misses it while any loaded episode is pending in that language', () => {
    const pending = episodeOf(1, 2, { pending_translation_language: 'de' });
    expect(seasonMissing([episodeOf(1, 1), pending], 'de')).toBe(true);
    expect(seasonMissing([episodeOf(1, 1), pending], 'fr')).toBe(false);
    expect(seasonMissing([episodeOf(1, 1)], 'de')).toBe(false);
    expect(seasonMissing(undefined, 'de')).toBe(false);
  });
});

describe('pageTargets', () => {
  const seasons = [seasonOf(1), seasonOf(2)];
  const base = {
    itemId: 'm1',
    detail: itemDetail(),
    series: false,
    shownSeason: undefined,
    seasons: [],
    episodes: undefined,
  };

  it('has none when nothing is pending', () => {
    expect(pageTargets(base)).toEqual([]);
  });

  it('names the item by the id the page uses, with the language as reported', () => {
    const detail = itemDetail({ pending_translation_language: 'pt-BR' });
    expect(pageTargets({ ...base, detail })).toEqual([
      { kind: 'item', id: 'm1', language: 'pt-BR' },
    ]);
  });

  it('names the shown season by its content id and the language of a pending episode', () => {
    const episodes = [episodeOf(2, 1), episodeOf(2, 2, { pending_translation_language: 'de' })];
    expect(
      pageTargets({
        ...base,
        detail: itemDetail({ type: 'series', pending_translation_language: 'de' }),
        series: true,
        shownSeason: 2,
        seasons,
        episodes,
      }),
    ).toEqual([
      { kind: 'item', id: 'm1', language: 'de' },
      { kind: 'season', id: 'season-2', language: 'de', season: 2 },
    ]);
  });

  it('has no season target on a movie, without a known season or without a pending episode', () => {
    const episodes = [episodeOf(1, 1, { pending_translation_language: 'de' })];
    const series = { ...base, series: true, shownSeason: 1, seasons, episodes };
    expect(pageTargets({ ...series, series: false })).toEqual([]);
    expect(pageTargets({ ...series, seasons: [] })).toEqual([]);
    expect(pageTargets({ ...series, episodes: [episodeOf(1, 1)] })).toEqual([]);
    expect(pageTargets({ ...series, shownSeason: undefined })).toEqual([]);
  });
});
