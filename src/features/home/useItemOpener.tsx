import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import type { CatalogItem } from '../../ui/media';
import { openItem } from './openItem';

const NOTE_MS = 4000;

/**
 * `open` is what a card does on OK; `note` is the message to render somewhere on the screen (it
 * is null while there is nothing to say). It disappears by itself.
 */
export function useItemOpener(onPlay: (item: CatalogItem) => void): {
  open: (item: CatalogItem) => void;
  note: ReactNode;
} {
  const t = useT();
  const [seriesNote, setSeriesNote] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const open = useCallback(
    (item: CatalogItem) => {
      openItem(item, {
        play: (playable) => {
          setSeriesNote(false);
          onPlay(playable);
        },
        showSeriesNote: () => {
          setSeriesNote(true);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setSeriesNote(false), NOTE_MS);
        },
      });
    },
    [onPlay],
  );

  const note = seriesNote ? (
    <p role="status" className="note toast" data-testid="series-note">
      {t('library.seriesLater')}
    </p>
  ) : null;
  return { open, note };
}
