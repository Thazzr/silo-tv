import { useCallback } from 'react';
import type { CatalogItem } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { openItem } from './openItem';

/** What a screen that shows cards hands over: the player and the detail page. */
export interface ItemHandlers {
  onPlay: (item: CatalogItem) => void;
  onOpenDetail: (target: DetailTarget) => void;
}

/** `open` is what a card does on OK (see `openItem`). */
export function useItemOpener({ onPlay, onOpenDetail }: ItemHandlers): {
  open: (item: CatalogItem) => void;
} {
  const open = useCallback(
    (item: CatalogItem) => openItem(item, { play: onPlay, openDetail: onOpenDetail }),
    [onPlay, onOpenDetail],
  );
  return { open };
}
