import { describe, expect, it } from 'vitest';
import { fileVersion, itemDetail, rollup } from '../../test/detailFixtures';
import { playedShare, primaryAction, watchedState } from './actions';

const series = (user = rollup()) =>
  itemDetail({ type: 'series', versions: [], user_data: user, content_id: 's1' });

describe('primaryAction: a movie', () => {
  const base = { kind: 'item' as const, playable: true, totalSeconds: 5400 };

  it('plays from the start without a resume point', () => {
    expect(primaryAction({ ...base, detail: itemDetail(), resumeSeconds: null })).toEqual({
      label: 'detail.play',
      mode: 'play',
      fill: null,
      startOverInMenu: false,
    });
  });

  it('shows Play with a progress fill and asks, when it has one version', () => {
    const action = primaryAction({ ...base, detail: itemDetail(), resumeSeconds: 1350 });
    expect(action).toEqual({
      label: 'detail.play',
      mode: 'ask',
      fill: 0.25,
      startOverInMenu: false,
    });
  });

  it('says Resume, resumes at once and moves Play from beginning to the menu, with several versions', () => {
    const detail = itemDetail({ versions: [fileVersion(), fileVersion({ file_id: 'file-2' })] });
    expect(primaryAction({ ...base, detail, resumeSeconds: 1350 })).toEqual({
      label: 'detail.resume',
      mode: 'resume',
      fill: 0.25,
      startOverInMenu: true,
    });
  });
});

describe('primaryAction: a series', () => {
  const base = { kind: 'series' as const, playable: true, resumeSeconds: null, totalSeconds: 0 };
  const label = (user: ReturnType<typeof rollup>) =>
    primaryAction({ ...base, detail: series(user) }).label;

  it('resumes while an episode is in progress', () => {
    expect(label(rollup({ in_progress_count: 1, watched_count: 2 }))).toBe('detail.resume');
  });

  it('offers the next episode when some are watched and not all', () => {
    expect(label(rollup({ watched_count: 2, unplayed_count: 3 }))).toBe('detail.playNext');
  });

  it('starts from episode 1 when nothing is watched', () => {
    expect(label(rollup())).toBe('detail.startFromFirst');
  });

  it('starts from episode 1 again when everything is watched', () => {
    expect(label(rollup({ played: true, watched_count: 5, unplayed_count: 0 }))).toBe(
      'detail.startFromFirst',
    );
  });

  it('browses the series, disabled, when there is no episode to play', () => {
    expect(primaryAction({ ...base, playable: false, detail: series() })).toMatchObject({
      label: 'detail.browseSeries',
      mode: 'none',
    });
  });

  it('resumes the episode at its resume point, whatever the label says', () => {
    expect(primaryAction({ ...base, resumeSeconds: 600, detail: series() }).mode).toBe('resume');
    expect(primaryAction({ ...base, detail: series() }).mode).toBe('play');
  });
});

describe('primaryAction: a season', () => {
  const season = (user = rollup()) =>
    itemDetail({ type: 'season', versions: [], user_data: user, content_id: 'se1' });
  const base = { kind: 'season' as const, resumeSeconds: null, totalSeconds: 0 };

  it('plays the first episode from the start, whatever the season has watched', () => {
    const started = season(rollup({ in_progress_count: 1, watched_count: 2 }));
    expect(primaryAction({ ...base, playable: true, detail: started })).toEqual({
      label: 'detail.playFirstEpisode',
      mode: 'play',
      fill: null,
      startOverInMenu: false,
    });
  });

  it('is disabled without an episode to play', () => {
    expect(primaryAction({ ...base, playable: false, detail: season() })).toMatchObject({
      label: 'detail.playFirstEpisode',
      mode: 'none',
    });
  });

  it('never resumes: a resume point of the episode is ignored', () => {
    expect(
      primaryAction({ ...base, resumeSeconds: 600, playable: true, detail: season() }).mode,
    ).toBe('play');
  });
});

describe('playedShare', () => {
  it('is the share within 0 to 1', () => {
    expect(playedShare(1350, 5400)).toBe(0.25);
    expect(playedShare(6000, 5400)).toBe(1);
    expect(playedShare(-5, 5400)).toBe(0);
  });

  it('is 0 without a total', () => {
    expect(playedShare(600, 0)).toBe(0);
  });
});

describe('watchedState', () => {
  const movie = (user?: ReturnType<typeof rollup>) => itemDetail({ user_data: user });

  it('labels a movie by its played state', () => {
    expect(watchedState(movie(), 'item')).toEqual({
      played: false,
      hasProgress: false,
      label: 'detail.markWatched',
      unwatchLabel: 'detail.markUnwatched',
    });
    expect(watchedState(movie(rollup({ played: true })), 'item')).toMatchObject({
      played: true,
      label: 'detail.markUnwatched',
    });
  });

  it('labels a series by its played state', () => {
    expect(watchedState(series(), 'series').label).toBe('detail.markSeriesWatched');
    expect(watchedState(series(rollup({ played: true })), 'series').label).toBe(
      'detail.markSeriesUnwatched',
    );
  });

  it('counts a movie with a saved position as not watched, even when it is played', () => {
    expect(watchedState(movie(rollup({ played: true, position_seconds: 600 })), 'item')).toEqual({
      played: false,
      hasProgress: true,
      label: 'detail.markWatched',
      unwatchLabel: 'detail.markUnwatched',
    });
  });

  it('has no progress for a series, whatever position its data carries', () => {
    expect(
      watchedState(series(rollup({ played: true, position_seconds: 50 })), 'series').hasProgress,
    ).toBe(false);
    expect(watchedState(series(rollup({ played: true })), 'series').hasProgress).toBe(false);
  });
});

describe('watchedState: a season', () => {
  const season = (user?: ReturnType<typeof rollup>) =>
    itemDetail({ type: 'season', versions: [], user_data: user });

  it('marks a season that is not watched as watched', () => {
    expect(watchedState(season(rollup()), 'season')).toEqual({
      played: false,
      hasProgress: false,
      label: 'detail.markSeasonWatched',
      unwatchLabel: 'detail.markSeasonUnwatched',
    });
  });

  it('marks a watched season as unwatched', () => {
    expect(watchedState(season(rollup({ played: true, watched_count: 3 })), 'season')).toEqual({
      played: true,
      hasProgress: false,
      label: 'detail.markSeasonUnwatched',
      unwatchLabel: 'detail.markSeasonUnwatched',
    });
  });

  it('offers to clear a season that was started: the toggle still marks it watched', () => {
    for (const started of [{ watched_count: 2 }, { in_progress_count: 1 }]) {
      expect(watchedState(season(rollup(started)), 'season')).toMatchObject({
        played: false,
        hasProgress: true,
        label: 'detail.markSeasonWatched',
      });
    }
  });

  it('counts a season with a saved position field as nothing special', () => {
    expect(watchedState(season(rollup({ position_seconds: 600 })), 'season').hasProgress).toBe(
      false,
    );
  });
});
