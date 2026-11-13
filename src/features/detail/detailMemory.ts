import { gridCardKey } from '../../ui/media/Grid';
import { FocusIndexMemory } from '../../ui/media/scroll';

/** What opening a detail page needs: the item whose page it is (a movie, series, season or episode). */
export interface DetailTarget {
  itemId: string;
  /**
   * The page was opened from a "More Episodes" card, which sits at `index` of the season's
   * episodes: the page replaces the one it was opened from (so Back leaves the walk through the
   * season at once) and starts with the focus on its own card in that row. Any other way in pushes
   * a page and starts on the primary button.
   */
  fromSibling?: { index: number };
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

/** The id of the episode grid of a season's (or a one-season series') page. */
export const episodeGridId = (pageItemId: string) => `episodes:${pageItemId}`;

/**
 * Where the page under a replaced episode page lands when Back reaches it: on the card of the
 * last episode viewed, if that page shows the episode in a grid (it has remembered a focus in it).
 * Its grid memory is moved to the episode too, so the grid mounts the card. Returns the card's
 * focus key, or null when the page does not show the episode (the focus stays where it was).
 */
export function restoreViewedEpisode(
  below: DetailEntryMemory,
  pageItemId: string,
  episodeId: string,
  index: number,
): string | null {
  const gridId = episodeGridId(pageItemId);
  if (below.rows.get(gridId) === undefined) return null;
  below.rows.set(gridId, index);
  return gridCardKey(gridId, episodeId);
}
