import { FocusIndexMemory } from '../../ui/media/scroll';

/** What opening a box set page needs; the title and backdrop paint the page before it is read. */
export interface BoxSetTarget {
  boxSetId: string;
  /** The library whose movies make up the box set (the read needs it). */
  libraryId: string;
  boxSetTitle?: string;
  backdropUrl?: string;
}

/** What one visit of a box set page remembers while a film's page covers it. */
export class BoxSetEntryMemory {
  /** The focused film of the grid. */
  readonly grid = new FocusIndexMemory();
}

/**
 * The memories of the box set pages on the screen stack, keyed by the stack entry's screen object
 * (see DetailMemory): a page that is opened again starts fresh, one that comes back from a film
 * keeps its focused card.
 */
export class BoxSetMemory {
  private readonly entries = new WeakMap<object, BoxSetEntryMemory>();

  of(entry: object): BoxSetEntryMemory {
    let memory = this.entries.get(entry);
    if (!memory) {
      memory = new BoxSetEntryMemory();
      this.entries.set(entry, memory);
    }
    return memory;
  }
}
