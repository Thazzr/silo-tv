import { FocusIndexMemory } from '../../ui/media/scroll';

/** What opening a detail page needs: the item whose page it is (a movie, series, season or episode). */
export interface DetailTarget {
  itemId: string;
}

/** What one visit of a detail page remembers while the player (or another page) covers it. */
export class DetailEntryMemory {
  /** The focused card of the seasons row, the episode grid, the cast row and "More like this". */
  readonly rows = new FocusIndexMemory();
}

/**
 * The memories of the detail pages on the screen stack, keyed by the stack entry's screen object:
 * a page that is opened again starts fresh, a page that comes back from the player keeps its
 * focused cards. The screen stack unmounts the page while another screen is on top, so this lives
 * with the flow.
 */
export class DetailMemory {
  private readonly entries = new WeakMap<object, DetailEntryMemory>();

  of(entry: object): DetailEntryMemory {
    let memory = this.entries.get(entry);
    if (!memory) {
      memory = new DetailEntryMemory();
      this.entries.set(entry, memory);
    }
    return memory;
  }
}
