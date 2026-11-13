import { useCallback } from 'react';
import type { StartIntent } from '../../playback/resume';
import type { CatalogItem } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { openItem, playCard } from './openItem';

/** What a screen that shows cards hands over: the player and the detail page. */
export interface ItemHandlers {
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
}

/**
 * `open` is what a card does on OK (see `openItem`); a featured slide's "More Info" does the same.
 * `play` is what the remote's Play key does on a card and what a slide's "Play" does (see
 * `playCard`).
 */
export function useItemOpener({ onPlay, onOpenDetail }: ItemHandlers): {
  open: (item: CatalogItem) => void;
  play: (item: CatalogItem) => void;
} {
  const open = useCallback(
    (item: CatalogItem) => openItem(item, { play: onPlay, openDetail: onOpenDetail }),
    [onPlay, onOpenDetail],
  );
  const play = useCallback(
    (item: CatalogItem) => playCard(item, { play: onPlay, openDetail: onOpenDetail }),
    [onPlay, onOpenDetail],
  );
  return { open, play };
}
