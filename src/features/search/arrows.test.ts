import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cardFocusKey, gridCardKey, gridFocusKey, rowFocusKey } from '../../ui/media';
import { keyFocusKey } from './keys';

const moved = vi.hoisted(() => [] as string[]);
vi.mock('../../app/nav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/nav')>()),
  moveFocusTo: (focusKey: string) => {
    moved.push(focusKey);
    return true as const;
  },
}));

const { blockOf, presentBlocks, searchArrows } = await import('./arrows');

beforeEach(() => {
  moved.length = 0;
});

const ALL = { pills: true, boxSets: true, people: true, grid: true };
const press = (
  direction: 'left' | 'right' | 'up' | 'down',
  from: string,
  present: Parameters<typeof presentBlocks>[0] = ALL,
) => searchArrows(() => present)(direction, from);

const pills = 'search-pills';
const boxSets = rowFocusKey('search-boxsets');
const people = rowFocusKey('search-people');
const grid = gridFocusKey('search');
const boxCard = cardFocusKey('search-boxsets', 'b1');
const personCard = cardFocusKey('search-people', 'p1');
const titleCard = gridCardKey('search', 't1');

describe('blockOf', () => {
  it('tells every focus key of the tab to its block', () => {
    expect(blockOf(keyFocusKey('a'))).toBe('keyboard');
    expect(blockOf('search-keyboard')).toBe('keyboard');
    expect(blockOf('search-pill:movies')).toBe('pills');
    expect(blockOf(boxCard)).toBe('boxSets');
    expect(blockOf(boxSets)).toBe('boxSets');
    expect(blockOf(personCard)).toBe('people');
    expect(blockOf(titleCard)).toBe('grid');
    expect(blockOf(grid)).toBe('grid');
    expect(blockOf('search-retry')).toBe('retry');
    expect(blockOf('shell-tab-search')).toBeNull();
    expect(blockOf(gridCardKey('browse:x', 'a'))).toBeNull();
  });
});

describe('searchArrows from the keyboard', () => {
  it('moves along the keys by index', () => {
    expect(press('right', keyFocusKey('a'))).toBe(true);
    expect(press('down', keyFocusKey('a'))).toBe(true);
    expect(moved).toEqual([keyFocusKey('b'), keyFocusKey('h')]);
  });

  it('goes on to the box sets, else the people, else the titles, else the segments', () => {
    press('right', keyFocusKey('g'));
    press('right', keyFocusKey('g'), { pills: true, people: true, grid: true });
    press('right', keyFocusKey('g'), { pills: true, grid: true });
    press('right', keyFocusKey('g'), { pills: true });
    expect(moved).toEqual([boxSets, people, grid, pills]);
  });

  it('swallows Right when there is nothing to go to, and leaves Up from the top row to the library', () => {
    expect(press('right', keyFocusKey('g'), {})).toBe(true);
    expect(moved).toEqual([]);
    expect(press('up', keyFocusKey('a'))).toBe(false);
    expect(press('left', keyFocusKey('a'))).toBe(true);
  });
});

describe('searchArrows from the results', () => {
  it('goes back to the keyboard from the first column of a row or the grid', () => {
    press('left', boxCard);
    press('left', personCard);
    press('left', titleCard);
    expect(moved).toEqual(['search-keyboard', 'search-keyboard', 'search-keyboard']);
  });

  it('goes back to the keyboard from the first segment, and lets the others move on their own', () => {
    expect(press('left', 'search-pill:all')).toBe(true);
    expect(moved).toEqual(['search-keyboard']);
    expect(press('left', 'search-pill:movies')).toBe(false);
    expect(press('right', 'search-pill:all')).toBe(false);
    expect(press('right', 'search-pill:series')).toBe(true);
  });

  it('treats Right at the edge of a row or the grid as an edge', () => {
    expect(press('right', titleCard)).toBe(true);
    expect(moved).toEqual([]);
  });

  it('moves between the blocks in reading order', () => {
    press('down', 'search-pill:all');
    press('down', boxCard);
    press('down', personCard);
    press('up', titleCard);
    press('up', personCard);
    press('up', boxCard);
    expect(moved).toEqual([boxSets, people, grid, people, boxSets, pills]);
  });

  it('skips missing blocks, hands Up from the first block to the library and ends at the last', () => {
    press('down', 'search-pill:all', { pills: true, grid: true });
    expect(moved).toEqual([grid]);
    expect(press('up', 'search-pill:all')).toBe(false);
    expect(press('down', titleCard)).toBe(true);
    expect(moved).toEqual([grid]);
  });

  it('knows nothing about keys of other screens', () => {
    expect(press('down', 'shell-tab-search')).toBe(false);
  });
});

describe('presentBlocks', () => {
  it('lists the blocks that exist in reading order', () => {
    expect(presentBlocks({ grid: true, pills: true, people: true })).toEqual([
      'pills',
      'people',
      'grid',
    ]);
  });
});
