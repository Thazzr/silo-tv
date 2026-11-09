import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { catalogItem } from '../../test/flowFixtures';
import { episodeMatch } from '../../test/searchFixtures';
import {
  countLabel,
  MAX_QUERY_LENGTH,
  normaliseQuery,
  peopleScope,
  resultSubtitle,
  titleType,
  wantsBoxSets,
  wantsPeople,
} from './info';

const en = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params);
const de = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('de', key, params);

describe('normaliseQuery', () => {
  it('trims the spaces around the text and keeps the ones inside', () => {
    expect(normaliseQuery('  star  wars ')).toBe('star  wars');
    expect(normaliseQuery('   ')).toBe('');
  });

  it('cuts the text to 200 characters', () => {
    expect(MAX_QUERY_LENGTH).toBe(200);
    expect(normaliseQuery('a'.repeat(250))).toHaveLength(200);
    expect(normaliseQuery('a'.repeat(200))).toHaveLength(200);
  });

  it('does not leave a space at the cut', () => {
    const text = `${'a'.repeat(199)} bbbb`;
    expect(normaliseQuery(text)).toBe('a'.repeat(199));
  });
});

describe('titleType', () => {
  const withEpisodes = { video_with_episodes_scope: true };

  it('searches movies, series and episodes for "All" when the server can', () => {
    expect(titleType('all', withEpisodes)).toBe('video_with_episodes');
  });

  it('falls back to movies and series for "All" without the capability, or without an answer', () => {
    expect(titleType('all', {})).toBe('video');
    expect(titleType('all', { video_with_episodes_scope: false })).toBe('video');
    expect(titleType('all', undefined)).toBe('video');
  });

  it('maps Movies and Series to their own type whatever the server can', () => {
    expect(titleType('movies', withEpisodes)).toBe('movie');
    expect(titleType('series', withEpisodes)).toBe('series');
    expect(titleType('movies', undefined)).toBe('movie');
  });
});

describe('what a segment offers', () => {
  it('scopes people like the "All" titles', () => {
    expect(peopleScope({ video_with_episodes_scope: true })).toBe('video_with_episodes');
    expect(peopleScope({})).toBe('video');
  });

  it('offers box sets for All and Movies when the server has them, never for Series', () => {
    expect(wantsBoxSets('all', { box_sets: true })).toBe(true);
    expect(wantsBoxSets('movies', { box_sets: true })).toBe(true);
    expect(wantsBoxSets('series', { box_sets: true })).toBe(false);
    expect(wantsBoxSets('all', { box_sets: false })).toBe(false);
    expect(wantsBoxSets('all', undefined)).toBe(false);
  });

  it('offers people for All only, and only with people_media_scope', () => {
    expect(wantsPeople('all', { people_media_scope: true })).toBe(true);
    expect(wantsPeople('movies', { people_media_scope: true })).toBe(false);
    expect(wantsPeople('series', { people_media_scope: true })).toBe(false);
    expect(wantsPeople('all', {})).toBe(false);
    expect(wantsPeople('all', undefined)).toBe(false);
  });
});

describe('countLabel', () => {
  it('says "N results", "1 result" and "N+ results" for an estimate', () => {
    expect(countLabel(12, true, en)).toBe('12 results');
    expect(countLabel(1, true, en)).toBe('1 result');
    expect(countLabel(200, false, en)).toBe('200+ results');
  });

  it('says it in German too', () => {
    expect(countLabel(12, true, de)).toBe('12 Ergebnisse');
    expect(countLabel(1, true, de)).toBe('1 Ergebnis');
    expect(countLabel(200, false, de)).toBe('200+ Ergebnisse');
  });

  it('counts one estimated result as "1+", not as "1 result"', () => {
    expect(countLabel(1, false, en)).toBe('1+ results');
  });
});

describe('resultSubtitle', () => {
  it('shows the year of a movie or series, nothing without one', () => {
    expect(resultSubtitle(catalogItem({ year: 1999 }))).toBe('1999');
    expect(resultSubtitle(catalogItem({ year: undefined }))).toBe('');
  });

  it('shows "S1 · E2 · Title" for an episode', () => {
    expect(resultSubtitle(episodeMatch())).toBe('S1 · E2 · The Pilot');
  });

  it('shows just the title of an episode whose numbers are unknown', () => {
    expect(resultSubtitle(episodeMatch({ season_number: undefined }))).toBe('The Pilot');
  });
});
