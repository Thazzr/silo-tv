import { useCallback } from 'react';
import type { StartIntent } from '../../playback/resume';
import type { CatalogItem } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { openItem, openItemPage, playFeatured } from './openItem';

/** What a screen that shows cards hands over: the player and the detail page. */
export interface ItemHandlers {
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
}

/**
 * `open` is what a card does on OK (see `openItem`). A featured slide has two buttons: `openPage`
 * for "More Info" and `playSlide` for "Play" (see `playFeatured`).
 */
export function useItemOpener({ onPlay, onOpenDetail }: ItemHandlers): {
  open: (item: CatalogItem) => void;
  openPage: (item: CatalogItem) => void;
  playSlide: (item: CatalogItem) => void;
} {
  const open = useCallback(
    (item: CatalogItem) => openItem(item, { play: onPlay, openDetail: onOpenDetail }),
    [onPlay, onOpenDetail],
  );
  const openPage = useCallback(
    (item: CatalogItem) => openItemPage(item, { play: onPlay, openDetail: onOpenDetail }),
    [onPlay, onOpenDetail],
  );
  const playSlide = useCallback(
    (item: CatalogItem) => playFeatured(item, { play: onPlay, openDetail: onOpenDetail }),
    [onPlay, onOpenDetail],
  );
  return { open, openPage, playSlide };
}
