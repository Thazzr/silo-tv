import { describe, expect, it } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import { boxSetSummary } from '../../test/boxSetFixtures';
import { translate } from '../../i18n';
import {
  boxSetCaption,
  cardSubtitle,
  cardTitle,
  filmCountText,
  GRID_IMAGE_QUERY,
  isLandscapeSection,
  landscapeArt,
  posterArt,
  ROW_IMAGE_QUERY,
  watchedFraction,
  yearsText,
} from './cardInfo';

const episode = catalogItem({
  type: 'episode',
  title: 'Pilot',
  series_title: 'Severance',
  season_number: 1,
  episode_number: 3,
});

describe('captions', () => {
  it('shows an episode under its series with "S1 · E3", a movie with its year', () => {
    expect(cardTitle(episode)).toBe('Severance');
    expect(cardSubtitle(episode)).toBe('S1 · E3');
    expect(cardTitle(catalogItem({ title: 'Heat' }))).toBe('Heat');
    expect(cardSubtitle(catalogItem({ year: 1995 }))).toBe('1995');
    expect(cardSubtitle(catalogItem({ year: undefined }))).toBe('');
  });

  it('falls back to the episode title without a series, and to no label without numbers', () => {
    const bare = catalogItem({ type: 'episode', title: 'Pilot' });
    expect(cardTitle(bare)).toBe('Pilot');
    expect(cardSubtitle(bare)).toBe('');
  });
});

describe('artwork', () => {
  it('uses the series poster for an episode in a poster row, the poster otherwise', () => {
    const art = posterArt({ ...episode, poster_url: '/still', series_poster_url: '/series' });
    expect(art.url).toBe('/series');
    expect(posterArt(catalogItem({ poster_url: '/p', poster_thumbhash: 'h' }))).toEqual({
      url: '/p',
      thumbhash: 'h',
    });
  });

  it('uses the backdrop for a landscape card and nothing when there is none', () => {
    expect(landscapeArt(catalogItem({ backdrop_url: '/b' })).url).toBe('/b');
    expect(landscapeArt(catalogItem({ series_backdrop_url: '/sb' })).url).toBe('/sb');
    expect(landscapeArt(catalogItem({ poster_url: '/p' })).url).toBeUndefined();
  });
});

describe('watchedFraction', () => {
  it('is the resume position over the duration, clamped to 0..1', () => {
    expect(watchedFraction(catalogItem({ position_seconds: 600, duration_seconds: 2400 }))).toBe(
      0.25,
    );
    expect(
      watchedFraction(catalogItem({ position_seconds: 2000, duration_seconds: 2400 })),
    ).toBeCloseTo(0.8333, 3);
  });

  it('shows the bar of a played rewatch that has a position', () => {
    expect(
      watchedFraction(
        catalogItem({
          item_source: 'in_progress',
          position_seconds: 362.464,
          duration_seconds: 3514,
          ...{ played: true },
        }),
      ),
    ).toBeCloseTo(362 / 3514, 5);
  });

  it('shows no bar for 30 s or less, or within 5 s of the end (no resume point)', () => {
    expect(
      watchedFraction(catalogItem({ position_seconds: 30, duration_seconds: 2400 })),
    ).toBeNull();
    expect(
      watchedFraction(catalogItem({ position_seconds: 9000, duration_seconds: 2400 })),
    ).toBeNull();
    expect(
      watchedFraction(catalogItem({ position_seconds: 2396, duration_seconds: 2400 })),
    ).toBeNull();
  });

  it('falls back to the runtime in minutes', () => {
    expect(watchedFraction(catalogItem({ position_seconds: 1800, runtime: 60 }))).toBe(0.5);
  });

  it('is null without a position, without a length, or for a "next up" card', () => {
    expect(watchedFraction(catalogItem({}))).toBeNull();
    expect(watchedFraction(catalogItem({ position_seconds: 100 }))).toBeNull();
    expect(
      watchedFraction(
        catalogItem({ position_seconds: 100, duration_seconds: 1000, item_source: 'next_up' }),
      ),
    ).toBeNull();
  });
});

describe('isLandscapeSection', () => {
  it.each(['continue_watching', 'next_up', 'in_progress', 'system-next-up'])(
    '%s shows landscape cards',
    (type) => expect(isLandscapeSection(type)).toBe(true),
  );
  it.each(['recently_added', 'genre', 'trending', 'collection'])('%s shows posters', (type) =>
    expect(isLandscapeSection(type)).toBe(false),
  );
});

describe('image widths', () => {
  it('asks for widths that fit the cards: a 2x poster, the hero backdrop, the title art', () => {
    expect(ROW_IMAGE_QUERY).toEqual({
      poster_width: 352,
      backdrop_width: 1920,
      logo_width: 880,
      still_width: 720,
    });
    expect(GRID_IMAGE_QUERY.poster_width).toBe(520);
  });
});

describe('box set captions', () => {
  const en = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate('en', key, params);

  it('writes the years as a range, one year when both are equal, none when unknown', () => {
    expect(yearsText(2001, 2011)).toBe('2001–2011');
    expect(yearsText(1999, 1999)).toBe('1999');
    expect(yearsText(2005, undefined)).toBe('2005');
    expect(yearsText(undefined, 2007)).toBe('2007');
    expect(yearsText(undefined, undefined)).toBeNull();
  });

  it('counts films, with the singular for one', () => {
    expect(filmCountText(8, en)).toBe('8 films');
    expect(filmCountText(1, en)).toBe('1 film');
  });

  it('shows the progress once a film is played', () => {
    const caption = boxSetCaption(boxSetSummary({ movie_count: 8, played_count: 5 }), en);
    expect(caption).toEqual({ title: 'Great Saga Box Set', sub: '5 / 8 watched' });
  });

  it('shows the progress as soon as one film is played', () => {
    expect(boxSetCaption(boxSetSummary({ movie_count: 8, played_count: 1 }), en).sub).toBe(
      '1 / 8 watched',
    );
  });

  it('shows the years while nothing is played, else the film count', () => {
    expect(boxSetCaption(boxSetSummary({ first_year: 2001, last_year: 2011 }), en).sub).toBe(
      '2001–2011',
    );
    expect(boxSetCaption(boxSetSummary({ first_year: 1999, last_year: 1999 }), en).sub).toBe(
      '1999',
    );
    expect(
      boxSetCaption(
        boxSetSummary({ first_year: undefined, last_year: undefined, movie_count: 4 }),
        en,
      ).sub,
    ).toBe('4 films');
  });
});
