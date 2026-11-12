import type { DetailTarget } from '../detail/detailMemory';
import type { StartIntent } from '../../playback/resume';
import type { CatalogItem } from '../../ui/media';

/** What activating an item can lead to; the screen that shows the cards supplies both. */
export interface OpenTargets {
  /** Opens the player for an episode of Continue Watching or Next Up (or another playable item). */
  play: (item: CatalogItem, intent?: StartIntent) => void;
  /** Opens the detail page of a title. */
  openDetail: (target: DetailTarget) => void;
}

/** Continue Watching and Next Up cards say so in `item_source`. */
function isResumeCard(item: CatalogItem): boolean {
  const source = item.item_source?.trim().toLowerCase();
  return source === 'in_progress' || source === 'next_up';
}

/**
 * Opens an item's own page: a movie, a series, a season or an episode has one; anything else
 * plays, and the player asks whether to resume.
 */
export function openItemPage(item: CatalogItem, targets: OpenTargets): void {
  const type = item.type.trim().toLowerCase();
  if (type === 'movie' || type === 'series' || type === 'season' || type === 'episode') {
    targets.openDetail({ itemId: item.content_id });
    return;
  }
  targets.play(item, { kind: 'ask' });
}

/**
 * The one place that decides what OK on a card does.
 * - A movie, a series or a season opens its own detail page.
 * - An episode card of Continue Watching or Next Up plays right away and resumes where it left
 *   off, like Silo's web client; any other episode card opens the episode's own page.
 * - Anything else plays, and the player asks whether to resume.
 */
export function openItem(item: CatalogItem, targets: OpenTargets): void {
  if (item.type.trim().toLowerCase() === 'episode' && isResumeCard(item)) {
    targets.play(item, { kind: 'resume' });
    return;
  }
  openItemPage(item, targets);
}

/**
 * "Play" of a featured slide. It plays what the item points at (a series' or season's target
 * episode, `play_content_id`) and resumes where it left off without asking, like the web's watch
 * route, which has no prompt either. A series or season without a target has nothing to play and
 * opens its page, as the web does for such titles.
 */
export function playFeatured(item: CatalogItem, targets: OpenTargets): void {
  const type = item.type.trim().toLowerCase();
  const playable =
    item.play_content_id ?? (type === 'series' || type === 'season' ? undefined : item.content_id);
  if (playable === undefined) {
    openItemPage(item, targets);
    return;
  }
  targets.play({ ...item, content_id: playable }, { kind: 'resume' });
}
