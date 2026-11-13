import { useMemo } from 'react';
import { useHomeSections } from '../../features/home/queries';
import type { CatalogItem } from '../../ui/media';

/**
 * What the profile is in the middle of, for the end screen's "On Deck" row, without the series
 * that just played. The web builds it from its progress list; the pinned client has no such read,
 * so this takes Home's own Continue Watching section (`GET /api/v2/home/sections`, the section of
 * type `continue_watching`), which carries the same items with their pictures and progress.
 */
export function useOnDeck(seriesId: string | undefined): {
  items: readonly CatalogItem[];
  pending: boolean;
} {
  const { query } = useHomeSections();
  const sections = query.data;
  const items = useMemo(
    () =>
      (sections ?? [])
        .filter((section) => section.section_type === 'continue_watching')
        .flatMap((section) => section.items)
        .filter((item) => seriesId === undefined || item.series_id !== seriesId),
    [sections, seriesId],
  );
  return { items, pending: query.isPending };
}
