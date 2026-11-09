import { FocusIndexMemory } from '../../ui/media/scroll';
import type { PersonFilter } from './info';

/** What opening a person page needs: the person, and their name when the opener knows it. */
export interface PersonTarget {
  personId: string;
  /** Paints the header at once, before the person has been read. */
  personName?: string;
}

/** What one visit of a person page remembers while a title's page covers it. */
export class PersonEntryMemory {
  /** The filmography filter the viewer chose. */
  filter: PersonFilter = 'all';

  pickFilter(filter: PersonFilter): void {
    this.filter = filter;
  }

  /** The focused card of the filmography grid. */
  readonly grid = new FocusIndexMemory();
}

/**
 * The memories of the person pages on the screen stack, keyed by the stack entry's screen object
 * (see DetailMemory): a page that is opened again starts fresh, one that comes back from a title
 * keeps its filter and its focused card.
 */
export class PersonMemory {
  private readonly entries = new WeakMap<object, PersonEntryMemory>();

  of(entry: object): PersonEntryMemory {
    let memory = this.entries.get(entry);
    if (!memory) {
      memory = new PersonEntryMemory();
      this.entries.set(entry, memory);
    }
    return memory;
  }
}
