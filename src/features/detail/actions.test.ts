import { describe, expect, it } from 'vitest';
import { fileVersion, itemDetail, rollup } from '../../test/detailFixtures';
import { playedShare, primaryAction, watchedState } from './actions';

const series = (user = rollup()) =>
  itemDetail({ type: 'series', versions: [], user_data: user, content_id: 's1' });

describe('primaryAction: a movie', () => {
  const base = { series: false, playable: true, totalSeconds: 5400 };

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
  const base = { series: true, playable: true, resumeSeconds: null, totalSeconds: 0 };
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
    expect(watchedState(movie(), false)).toEqual({
      played: false,
      hasProgress: false,
      label: 'detail.markWatched',
    });
    expect(watchedState(movie(rollup({ played: true })), false)).toMatchObject({
      played: true,
      label: 'detail.markUnwatched',
    });
  });

  it('labels a series by its played state', () => {
    expect(watchedState(series(), true).label).toBe('detail.markSeriesWatched');
    expect(watchedState(series(rollup({ played: true })), true).label).toBe(
      'detail.markSeriesUnwatched',
    );
  });

  it('counts a movie with a saved position as not watched, even when it is played', () => {
    expect(watchedState(movie(rollup({ played: true, position_seconds: 600 })), false)).toEqual({
      played: false,
      hasProgress: true,
      label: 'detail.markWatched',
    });
  });

  it('has no progress for a series, whatever position its data carries', () => {
    expect(
      watchedState(series(rollup({ played: true, position_seconds: 50 })), true).hasProgress,
    ).toBe(false);
    expect(watchedState(series(rollup({ played: true })), true).hasProgress).toBe(false);
  });
});
