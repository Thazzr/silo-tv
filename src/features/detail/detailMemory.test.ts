import { describe, expect, it } from 'vitest';
import {
  DetailEntryMemory,
  DetailMemory,
  episodeGridId,
  restoreViewedEpisode,
} from './detailMemory';

describe('DetailMemory', () => {
  it('gives the same memory to the same stack entry and a fresh one to another', () => {
    const memory = new DetailMemory();
    const entry = { name: 'detail', itemId: 's1' };
    const again = { name: 'detail', itemId: 's1' };
    memory.of(entry).rows.set('episodes', 2);
    expect(memory.of(entry).rows.get('episodes')).toBe(2);
    // The same title opened again is a new entry: nothing is remembered from the first visit.
    expect(memory.of(again).rows.get('episodes')).toBeUndefined();
  });
});

describe('DetailEntryMemory', () => {
  it('lets the start in the episode row happen once per visit', () => {
    const entry = new DetailMemory().of({ name: 'detail' });
    expect(entry.takeStartInRow()).toBe(true);
    expect(entry.takeStartInRow()).toBe(false);
  });
});

describe('restoreViewedEpisode', () => {
  it("moves the page's episode grid to the viewed episode and names its card", () => {
    const below = new DetailEntryMemory();
    below.rows.set(episodeGridId('season-1'), 0);
    expect(restoreViewedEpisode(below, 'season-1', 'e3', 2)).toBe('gcard:episodes:season-1:e3');
    expect(below.rows.get('episodes:season-1')).toBe(2);
  });

  it('leaves a page without an episode grid alone', () => {
    const below = new DetailEntryMemory();
    below.rows.set('detail-seasons', 1);
    expect(restoreViewedEpisode(below, 's1', 'e3', 2)).toBeNull();
    expect(below.rows.get('episodes:s1')).toBeUndefined();
    expect(below.rows.get('detail-seasons')).toBe(1);
  });
});
