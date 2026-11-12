import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../i18n';
import { catalogItem } from '../../test/flowFixtures';
import type { CatalogItem } from '../../ui/media';
import { heroMeta } from './heroMeta';

const context = (lang: 'de' | 'en') => ({
  t: (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params),
  lang,
});

const verity = catalogItem({
  year: 2026,
  runtime: 118,
  rating_tmdb: 7,
  genres: ['Mystery', 'Thriller', 'Drama'],
  content_rating: 'r',
});

describe('heroMeta: a title', () => {
  it('lists year, runtime, the rating as text, two genres and the content rating, in that order', () => {
    expect(heroMeta(verity, context('de'))).toBe(
      '2026 · 1 Std. 58 Min. · TMDB 7.0 · Mystery · Thriller · R',
    );
    expect(heroMeta(verity, context('en'))).toBe(
      '2026 · 1h 58m · TMDB 7.0 · Mystery · Thriller · R',
    );
  });

  it('writes minutes alone under an hour and whole hours without minutes', () => {
    expect(heroMeta(catalogItem({ year: 0, runtime: 45 }), context('de'))).toBe('45 Min.');
    expect(heroMeta(catalogItem({ year: 0, runtime: 45 }), context('en'))).toBe('45 min');
    expect(heroMeta(catalogItem({ year: 0, runtime: 120 }), context('de'))).toBe('2 Std.');
    expect(heroMeta(catalogItem({ year: 0, runtime: 120 }), context('en'))).toBe('2h');
  });

  it('takes the runtime from the duration when the item has no runtime', () => {
    expect(heroMeta(catalogItem({ year: 0, duration_seconds: 5400 }), context('en'))).toBe(
      '1h 30m',
    );
  });

  it('names a genre once, trimmed, and skips empty ones', () => {
    const item = catalogItem({ year: 0, genres: [' Drama', 'Drama', '', 'Crime', 'Thriller'] });
    expect(heroMeta(item, context('en'))).toBe('Drama · Crime');
  });

  it('shows the first rating source it has a score for', () => {
    expect(
      heroMeta(catalogItem({ year: 0, rating_tmdb: 6.5, rating_imdb: 8.1 }), context('en')),
    ).toBe('IMDb 8.1');
    expect(heroMeta(catalogItem({ year: 0, rating_rt_critic: 91 }), context('en'))).toBe('RT 91%');
  });

  it('prefers the runtime to the duration and rounds the duration to whole minutes', () => {
    expect(
      heroMeta(catalogItem({ year: 0, runtime: 90, duration_seconds: 7200 }), context('en')),
    ).toBe('1h 30m');
    // 59.5 minutes is an hour; 3601 s is 60.02 minutes, also an hour (not 61 minutes).
    expect(heroMeta(catalogItem({ year: 0, duration_seconds: 3570 }), context('de'))).toBe(
      '1 Std.',
    );
    expect(heroMeta(catalogItem({ year: 0, duration_seconds: 3601 }), context('de'))).toBe(
      '1 Std.',
    );
    expect(heroMeta(catalogItem({ year: 0, duration_seconds: 3630 }), context('de'))).toBe(
      '1 Std. 1 Min.',
    );
  });

  it('leaves out a year that is not a whole number', () => {
    expect(heroMeta(catalogItem({ year: 2019.5 }), context('en'))).toBe('');
  });

  it('trims the content rating and writes it in capitals', () => {
    expect(heroMeta(catalogItem({ year: 0, content_rating: ' pg-13 ' }), context('en'))).toBe(
      'PG-13',
    );
  });

  it('copes with a card that carries no genres at all', () => {
    const card = { ...catalogItem({ year: 1995 }), genres: undefined } as unknown as CatalogItem;
    expect(heroMeta(card, context('en'))).toBe('1995');
  });

  it('leaves out what the item does not have', () => {
    expect(heroMeta(catalogItem({ year: 0 }), context('en'))).toBe('');
    expect(heroMeta(catalogItem({ year: 1995 }), context('en'))).toBe('1995');
  });
});

describe('heroMeta: an episode', () => {
  const episode = catalogItem({
    type: 'episode',
    season_number: 4,
    episode_number: 7,
    runtime: 52,
    year: 2024,
    rating_tmdb: 8,
    genres: ['Drama'],
    content_rating: 'tv-ma',
  });

  it('shows the episode, the runtime and the content rating only', () => {
    expect(heroMeta(episode, context('de'))).toBe('S4 · F7 · 52 Min. · TV-MA');
    expect(heroMeta(episode, context('en'))).toBe('S4 · E7 · 52 min · TV-MA');
  });

  it('counts season 0 (specials) and episode 0 as numbers', () => {
    expect(heroMeta({ ...episode, season_number: 0, episode_number: 0 }, context('en'))).toBe(
      'S0 · E0 · 52 min · TV-MA',
    );
  });

  it('gives no identity for a negative number', () => {
    expect(heroMeta({ ...episode, season_number: -1 }, context('en'))).toBe('52 min · TV-MA');
  });

  it('skips the identity when a number is missing', () => {
    expect(heroMeta({ ...episode, episode_number: undefined }, context('en'))).toBe(
      '52 min · TV-MA',
    );
  });
});
