import { describe, expect, it } from 'vitest';
import {
  NO_NEIGHBOURS,
  isPlayable,
  neighbourList,
  neighboursOf,
  nextSeasonNumber,
  type NeighbourEpisode,
} from './neighbours';

const ep = (
  season: number,
  number: number,
  files?: { unreadable?: boolean }[],
): NeighbourEpisode => ({
  content_id: `e${season}${number}`,
  season_number: season,
  episode_number: number,
  title: `Episode ${season}.${number}`,
  ...(files ? { files } : {}),
});

const ids = (list: readonly { contentId: string }[]) => list.map((e) => e.contentId);

describe('nextSeasonNumber', () => {
  const seasons = [0, 1, 2].map((n) => ({ season_number: n }));

  it('is the season numbered right after the current one, when the series lists it', () => {
    expect(nextSeasonNumber(seasons, 1)).toBe(2);
    expect(nextSeasonNumber(seasons, 0)).toBe(1);
  });

  it('is none after the last season, and none when the next number is missing', () => {
    expect(nextSeasonNumber(seasons, 2)).toBeUndefined();
    expect(nextSeasonNumber([{ season_number: 1 }, { season_number: 3 }], 1)).toBeUndefined();
    expect(nextSeasonNumber([], 1)).toBeUndefined();
  });
});

describe('isPlayable', () => {
  it('is false only when every file is unreadable', () => {
    expect(isPlayable(ep(1, 1, [{ unreadable: true }]))).toBe(false);
    expect(isPlayable(ep(1, 1, [{ unreadable: true }, { unreadable: true }]))).toBe(false);
    expect(isPlayable(ep(1, 1, [{ unreadable: true }, {}]))).toBe(true);
    expect(isPlayable(ep(1, 1, [{ unreadable: false }]))).toBe(true);
  });

  it('keeps an episode whose list entry names no files at all', () => {
    expect(isPlayable(ep(1, 1))).toBe(true);
    expect(isPlayable(ep(1, 1, []))).toBe(true);
  });
});

describe('neighbourList and neighboursOf', () => {
  it('finds both neighbours within a season', () => {
    const list = neighbourList([ep(1, 1), ep(1, 2), ep(1, 3)]);
    const found = neighboursOf(list, 1, 2);
    expect(found.previous).toEqual({
      contentId: 'e11',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Episode 1.1',
    });
    expect(found.next?.contentId).toBe('e13');
  });

  it('crosses from the last episode of a season into the first of the next', () => {
    const list = neighbourList([ep(1, 1), ep(1, 2)], [ep(2, 1), ep(2, 2)]);
    expect(neighboursOf(list, 1, 2).next?.contentId).toBe('e21');
    expect(neighboursOf(list, 1, 2).previous?.contentId).toBe('e11');
  });

  it('has no Previous at the first episode of the loaded seasons: the previous season is not part of the list', () => {
    const list = neighbourList([ep(2, 1), ep(2, 2)], [ep(3, 1)]);
    expect(neighboursOf(list, 2, 1).previous).toBeNull();
    expect(neighboursOf(list, 2, 1).next?.contentId).toBe('e22');
  });

  it('has no Next after the last episode of the loaded seasons', () => {
    expect(neighboursOf(neighbourList([ep(1, 1), ep(1, 2)]), 1, 2).next).toBeNull();
    expect(neighboursOf(neighbourList([ep(1, 1)], [ep(2, 1)]), 2, 1).next).toBeNull();
  });

  it('steps over episodes that cannot play, in both directions', () => {
    const list = neighbourList([
      ep(1, 1),
      ep(1, 2, [{ unreadable: true }]),
      ep(1, 3),
      ep(1, 4, [{ unreadable: true }]),
      ep(1, 5),
    ]);
    expect(ids(list)).toEqual(['e11', 'e13', 'e15']);
    expect(neighboursOf(list, 1, 3).previous?.contentId).toBe('e11');
    expect(neighboursOf(list, 1, 3).next?.contentId).toBe('e15');
    // Across the season line, too: the next season's unplayable first episode is skipped.
    const across = neighbourList([ep(1, 1)], [ep(2, 1, [{ unreadable: true }]), ep(2, 2)]);
    expect(neighboursOf(across, 1, 1).next?.contentId).toBe('e22');
  });

  it('orders season 0 like any season, and its Next is the first episode of season 1', () => {
    const list = neighbourList([ep(0, 1), ep(0, 2)], [ep(1, 1)]);
    expect(neighboursOf(list, 0, 1).next?.contentId).toBe('e02');
    expect(neighboursOf(list, 0, 2).next?.contentId).toBe('e11');
    expect(neighboursOf(list, 0, 2).previous?.contentId).toBe('e01');
  });

  it('keeps the order the server lists the episodes in', () => {
    const list = neighbourList([ep(1, 3), ep(1, 1), ep(1, 2)]);
    expect(neighboursOf(list, 1, 1).previous?.contentId).toBe('e13');
    expect(neighboursOf(list, 1, 1).next?.contentId).toBe('e12');
  });

  it('has no neighbours when the episode is not in the list', () => {
    const list = neighbourList([ep(1, 1), ep(1, 2)]);
    expect(neighboursOf(list, 1, 9)).toBe(NO_NEIGHBOURS);
    expect(neighboursOf([], 1, 1)).toEqual({ previous: null, next: null });
  });

  it('matches by season and episode number together', () => {
    const list = neighbourList([ep(1, 2)], [ep(2, 2), ep(2, 3)]);
    expect(neighboursOf(list, 2, 2).previous?.contentId).toBe('e12');
    expect(neighboursOf(list, 2, 2).next?.contentId).toBe('e23');
  });
});
