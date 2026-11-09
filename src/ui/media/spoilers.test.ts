import { describe, expect, it } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import {
  cardShowsEpisodeStill,
  cardUnwatched,
  episodeRowUnwatched,
  heroProtection,
  protectsCardArt,
  protectsEpisodeOverview,
  protectsEpisodeStill,
} from './spoilers';

const ON = { images: true, overviews: true };
const OFF = { images: false, overviews: false };

const episodeCard = (overrides: Parameters<typeof catalogItem>[0] = {}) =>
  catalogItem({ type: 'episode', title: 'Pilot', backdrop_url: '/still', ...overrides });

describe('episodeRowUnwatched', () => {
  const data = (overrides: object) => ({
    user_data: { played: false, in_progress_count: 0, ...overrides },
  });

  it('is unwatched without watch data, or when nothing was played or started', () => {
    expect(episodeRowUnwatched({})).toBe(true);
    expect(episodeRowUnwatched(data({}))).toBe(true);
    expect(episodeRowUnwatched(data({ position_seconds: 0, is_in_progress: false }))).toBe(true);
  });

  it('is watched when played, in progress or at a saved position', () => {
    expect(episodeRowUnwatched(data({ played: true }))).toBe(false);
    expect(episodeRowUnwatched(data({ is_in_progress: true }))).toBe(false);
    expect(episodeRowUnwatched(data({ position_seconds: 12 }))).toBe(false);
  });
});

describe('cardUnwatched', () => {
  it('is unwatched without watch data', () => {
    expect(cardUnwatched(episodeCard())).toBe(true);
  });

  it('is watched when played or at a saved position', () => {
    const state = { in_watchlist: false, is_favorite: false, not_interested: false };
    expect(cardUnwatched(episodeCard({ user_state: { ...state, played: true } }))).toBe(false);
    expect(cardUnwatched(episodeCard({ user_state: { ...state, played: false } }))).toBe(true);
    expect(cardUnwatched(episodeCard({ position_seconds: 5 }))).toBe(false);
    expect(cardUnwatched(episodeCard({ position_seconds: 0 }))).toBe(true);
  });
});

describe('cardShowsEpisodeStill (provenance of the picture actually shown)', () => {
  it('treats true and an absent answer as a still, false as other artwork', () => {
    const poster = { poster_url: '/p' };
    expect(
      cardShowsEpisodeStill(episodeCard({ ...poster, poster_is_episode_still: true }), 'poster'),
    ).toBe(true);
    expect(cardShowsEpisodeStill(episodeCard(poster), 'poster')).toBe(true);
    expect(
      cardShowsEpisodeStill(episodeCard({ ...poster, poster_is_episode_still: false }), 'poster'),
    ).toBe(false);
    expect(
      cardShowsEpisodeStill(episodeCard({ backdrop_is_episode_still: true }), 'landscape'),
    ).toBe(true);
    expect(cardShowsEpisodeStill(episodeCard(), 'landscape')).toBe(true);
    expect(
      cardShowsEpisodeStill(episodeCard({ backdrop_is_episode_still: false }), 'landscape'),
    ).toBe(false);
  });

  it('never counts the series or season artwork an episode card falls back to', () => {
    expect(
      cardShowsEpisodeStill(
        episodeCard({ poster_url: '/still', series_poster_url: '/series' }),
        'poster',
      ),
    ).toBe(false);
    expect(
      cardShowsEpisodeStill(
        episodeCard({ poster_url: '/still', season_poster_url: '/season' }),
        'poster',
      ),
    ).toBe(false);
    expect(
      cardShowsEpisodeStill(
        episodeCard({ backdrop_url: undefined, series_backdrop_url: '/series' }),
        'landscape',
      ),
    ).toBe(false);
  });

  it('uses the provenance of the poster, not of the backdrop, for a poster card', () => {
    const item = episodeCard({
      poster_url: '/p',
      poster_is_episode_still: false,
      backdrop_is_episode_still: true,
    });
    expect(cardShowsEpisodeStill(item, 'poster')).toBe(false);
  });

  it('is false for anything that is not an episode, or has no picture', () => {
    expect(cardShowsEpisodeStill(catalogItem({ poster_url: '/p' }), 'poster')).toBe(false);
    expect(cardShowsEpisodeStill(episodeCard({ backdrop_url: undefined }), 'landscape')).toBe(
      false,
    );
  });
});

describe('protectsCardArt', () => {
  it('needs the setting, an unwatched episode and a still', () => {
    expect(protectsCardArt(episodeCard(), 'landscape', ON)).toBe(true);
    expect(protectsCardArt(episodeCard(), 'landscape', { images: false, overviews: true })).toBe(
      false,
    );
    expect(protectsCardArt(episodeCard({ position_seconds: 30 }), 'landscape', ON)).toBe(false);
    expect(
      protectsCardArt(episodeCard({ backdrop_is_episode_still: false }), 'landscape', ON),
    ).toBe(false);
  });
});

describe('protectsEpisodeStill and protectsEpisodeOverview', () => {
  it('protect an unwatched row, each by its own setting', () => {
    expect(protectsEpisodeStill({}, ON)).toBe(true);
    expect(protectsEpisodeStill({}, { images: false, overviews: true })).toBe(false);
    expect(protectsEpisodeOverview({}, ON)).toBe(true);
    expect(protectsEpisodeOverview({}, { images: true, overviews: false })).toBe(false);
  });

  it('leave a watched row alone, and a still that is not the episode own', () => {
    const watched = { user_data: { played: true } };
    expect(protectsEpisodeStill(watched, ON)).toBe(false);
    expect(protectsEpisodeOverview(watched, ON)).toBe(false);
    expect(protectsEpisodeStill({ still_is_episode_still: false }, ON)).toBe(false);
    expect(protectsEpisodeStill({ still_is_episode_still: true }, ON)).toBe(true);
  });
});

describe('heroProtection', () => {
  const item = (overrides: Parameters<typeof catalogItem>[0] = {}) =>
    episodeCard({ overview: 'Spoiler', ...overrides });

  it('drops the own still and the overview of an unwatched episode', () => {
    expect(heroProtection(item(), ON)).toEqual({ hideBackdrop: true, hideOverview: true });
  });

  it('keeps the series backdrop: the backdrop is only hidden when it would be the own still', () => {
    expect(heroProtection(item({ series_backdrop_url: '/series' }), ON).hideBackdrop).toBe(false);
    expect(heroProtection(item({ backdrop_is_episode_still: false }), ON).hideBackdrop).toBe(false);
  });

  it('hides nothing for a watched episode, a movie, or with the settings off', () => {
    expect(heroProtection(item({ position_seconds: 9 }), ON)).toEqual({
      hideBackdrop: false,
      hideOverview: false,
    });
    expect(heroProtection(catalogItem({ backdrop_url: '/b' }), ON)).toEqual({
      hideBackdrop: false,
      hideOverview: false,
    });
    expect(heroProtection(item(), OFF)).toEqual({ hideBackdrop: false, hideOverview: false });
  });
});
