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
 * The one place that decides what OK on a card does.
 * - A movie or a series opens its detail page.
 * - An episode card of Continue Watching or Next Up plays right away and resumes where it left
 *   off, like Silo's web client; any other episode card opens its series with that season selected and that episode
 *   focused. A season card opens its series on that season.
 * - Anything else plays, and the player asks whether to resume.
 */
export function openItem(item: CatalogItem, targets: OpenTargets): void {
  const type = item.type.trim().toLowerCase();
  if (type === 'movie' || type === 'series') {
    targets.openDetail({ itemId: item.content_id });
    return;
  }
  if (type === 'season' && item.series_id) {
    targets.openDetail({ itemId: item.series_id, season: item.season_number });
    return;
  }
  if (type === 'episode' && isResumeCard(item)) {
    targets.play(item, { kind: 'resume' });
    return;
  }
  if (type === 'episode' && item.series_id) {
    targets.openDetail({
      itemId: item.series_id,
      season: item.season_number,
      episodeId: item.content_id,
    });
    return;
  }
  targets.play(item, { kind: 'ask' });
}
