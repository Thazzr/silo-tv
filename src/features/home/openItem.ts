import type { DetailTarget } from '../detail/detailMemory';
import type { StartIntent } from '../../playback/resume';
import type { CatalogItem } from '../../ui/media';

/** What activating an item can lead to; the screen that shows the cards supplies both. */
export interface OpenTargets {
  /** Opens the player for an item. */
  play: (item: CatalogItem, intent?: StartIntent) => void;
  /** Opens the detail page of a title. */
  openDetail: (target: DetailTarget) => void;
}

/**
 * The one place that decides what OK on a card does, Continue Watching and Next Up included (the
 * web's card links to the page too; only its small play button starts the watch route).
 * - A movie, a series, a season or an episode opens its own detail page.
 * - Anything else plays, and the player asks whether to resume.
 */
export function openItem(item: CatalogItem, targets: OpenTargets): void {
  const type = item.type.trim().toLowerCase();
  if (type === 'movie' || type === 'series' || type === 'season' || type === 'episode') {
    targets.openDetail({ itemId: item.content_id });
    return;
  }
  targets.play(item, { kind: 'ask' });
}

/**
 * "Play" of a featured slide, and the remote's Play key on any card (in place of the web's play
 * button). It plays what the item points at (a series' or season's target episode,
 * `play_content_id`) and resumes where it left off without asking, like the web's watch route,
 * which has no prompt either. A series or season without a target has nothing to play and opens
 * its page, as the web does for such titles.
 */
export function playCard(item: CatalogItem, targets: OpenTargets): void {
  const type = item.type.trim().toLowerCase();
  const playable =
    item.play_content_id ?? (type === 'series' || type === 'season' ? undefined : item.content_id);
  if (playable === undefined) {
    openItem(item, targets);
    return;
  }
  targets.play({ ...item, content_id: playable }, { kind: 'resume' });
}
