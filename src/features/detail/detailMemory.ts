import { FocusIndexMemory } from '../../ui/media/scroll';

/** What opening a detail page needs: the title, and for a series the season and episode to show. */
export interface DetailTarget {
  /** The movie or the series. */
  itemId: string;
  /** The season to show first; a series' own play target decides when it is missing. */
  season?: number;
  /** The episode to focus (and that "Play" plays) when the page was opened from an episode card. */
  episodeId?: string;
}

/** What one visit of a detail page remembers while the player (or another page) covers it. */
export class DetailEntryMemory {
  /** The season the viewer picked; undefined until they pick one. */
  season: number | undefined;

  pickSeason(season: number): void {
    this.season = season;
  }

  /** The focused card of the episode strip (per season), the cast row and "More like this". */
  readonly rows = new FocusIndexMemory();
}

/**
 * The memories of the detail pages on the screen stack, keyed by the stack entry's screen object:
 * a page that is opened again starts fresh, a page that comes back from the player keeps its
 * season and its focused cards. The screen stack unmounts the page while another screen is on
 * top, so this lives with the flow.
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
