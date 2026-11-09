// Where the arrow keys lead in the Search tab: along the keyboard, from its right edge into the
// results and back, and up and down the blocks of the results.
import { moveFocusTo, type ArrowHandler } from '../../app/nav';
import { gridFocusKey, rowFocusKey } from '../../ui/media';
import { SEGMENTS } from './info';
import { keyFocusKey, keyOfFocusKey, moveOnKeyboard } from './keys';

export const SEARCH_KEYBOARD_KEY = 'search-keyboard';
export const SEARCH_PILLS_KEY = 'search-pills';
export const SEARCH_PILL_PREFIX = 'search-pill:';
export const SEARCH_RETRY_KEY = 'search-retry';
export const BOX_SET_ROW_ID = 'search-boxsets';
export const PEOPLE_ROW_ID = 'search-people';
export const SEARCH_GRID_ID = 'search';

// The pill keys follow the segments' order.
const firstPillKey = `${SEARCH_PILL_PREFIX}${SEGMENTS[0]}`;
const lastPillKey = `${SEARCH_PILL_PREFIX}${SEGMENTS[SEGMENTS.length - 1]}`;

/** The parts of the tab, from the keyboard through the blocks of the results in reading order. */
export type SearchBlock = 'keyboard' | 'pills' | 'boxSets' | 'people' | 'grid' | 'retry';

const BLOCK_KEYS: Record<Exclude<SearchBlock, 'keyboard'>, string> = {
  pills: SEARCH_PILLS_KEY,
  boxSets: rowFocusKey(BOX_SET_ROW_ID),
  people: rowFocusKey(PEOPLE_ROW_ID),
  grid: gridFocusKey(SEARCH_GRID_ID),
  retry: SEARCH_RETRY_KEY,
};

/** Which part a focus key belongs to (a card, a group, a pill, a key); null for anything else. */
export function blockOf(focusKey: string): SearchBlock | null {
  if (keyOfFocusKey(focusKey) || focusKey === SEARCH_KEYBOARD_KEY) return 'keyboard';
  if (focusKey === SEARCH_PILLS_KEY || focusKey.startsWith(SEARCH_PILL_PREFIX)) return 'pills';
  if (focusKey === BLOCK_KEYS.boxSets || focusKey.startsWith(`card:${BOX_SET_ROW_ID}:`)) {
    return 'boxSets';
  }
  if (focusKey === BLOCK_KEYS.people || focusKey.startsWith(`card:${PEOPLE_ROW_ID}:`)) {
    return 'people';
  }
  if (focusKey === BLOCK_KEYS.grid || focusKey.startsWith(`gcard:${SEARCH_GRID_ID}:`)) {
    return 'grid';
  }
  return focusKey === SEARCH_RETRY_KEY ? 'retry' : null;
}

export type PresentBlocks = Partial<Record<Exclude<SearchBlock, 'keyboard'>, boolean>>;

const ORDER = ['pills', 'boxSets', 'people', 'grid', 'retry'] as const;

/** The blocks that exist now, in reading order. */
export function presentBlocks(present: PresentBlocks): (typeof ORDER)[number][] {
  return ORDER.filter((block) => present[block] === true);
}

/**
 * The arrow handler of the whole tab. `present` says which blocks have something to focus. The
 * rows and the grid decide their own presses first; what reaches this handler is a press at their
 * edge: Left from the first column goes back to the keyboard, Up and Down move to the next block.
 */
export function searchArrows(present: () => PresentBlocks): ArrowHandler {
  return (direction, fromKey) => {
    const block = blockOf(fromKey);
    if (block === null) return false;
    const blocks = presentBlocks(present());

    if (block === 'keyboard') {
      const key = keyOfFocusKey(fromKey);
      // The group itself holds the focus (it has no keys): leave the press to the library.
      if (!key) return false;
      const move = moveOnKeyboard(direction, key);
      if ('to' in move) return moveFocusTo(keyFocusKey(move.to.id));
      if ('out' in move) {
        // Box sets, else people, else the titles; the segments only when there is nothing else.
        const first = blocks.find((block) => block !== 'pills') ?? blocks[0];
        return first ? moveFocusTo(BLOCK_KEYS[first]) : true;
      }
      // Up from the first row: the tab bar, found by the library.
      return 'up' in move ? false : true;
    }

    if (direction === 'left') {
      // The first pill, or the edge of a block that declined the press: back to the keyboard. A
      // pill with a neighbour on its left lets the library move there.
      if (block === 'pills' && fromKey !== firstPillKey) return false;
      return moveFocusTo(SEARCH_KEYBOARD_KEY);
    }
    if (direction === 'right') {
      // A pill with a neighbour on its right lets the library move there; every other press
      // that got this far is at the edge.
      return block !== 'pills' || fromKey === lastPillKey;
    }
    const at = blocks.indexOf(block);
    const target = blocks[at + (direction === 'down' ? 1 : -1)];
    if (target) return moveFocusTo(BLOCK_KEYS[target]);
    // Up from the first block is the tab bar's; Down from the last one is the end.
    return direction === 'up' ? false : true;
  };
}
