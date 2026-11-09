import type { CatalogItem } from '../../ui/media';

/** What activating an item can lead to; the screen that shows the cards supplies both. */
export interface OpenTargets {
  /** Opens the player for a movie or an episode. */
  play: (item: CatalogItem) => void;
  /** Tells the viewer that a series has no page yet. */
  showSeriesNote: () => void;
}

/**
 * The one place that decides what OK on a card does. Until the detail pages arrive (Phase 2), a
 * movie or an episode plays and a series only says so; the detail pages replace this function and
 * nothing else.
 */
export function openItem(item: CatalogItem, targets: OpenTargets): void {
  const type = item.type.trim().toLowerCase();
  if (type === 'series' || type === 'season') {
    targets.showSeriesNote();
    return;
  }
  targets.play(item);
}
