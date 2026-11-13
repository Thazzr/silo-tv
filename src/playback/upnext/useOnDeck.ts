import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';
import { itemDetailOptions } from '../../features/detail/queries';
import type { CatalogItem } from '../../ui/media';

type ProgressEntry = components['schemas']['ProgressEntry'];

/** The row shows what the profile touched last, as the web's end screen asks for it. */
const ON_DECK_LIMIT = 20;

/**
 * One function for every render: a combine whose reference changes is run again, and its fresh
 * array would make the row redraw its cards on each tick of the end screen's countdown.
 */
const dataOf = (results: { data?: components['schemas']['CatalogItemDetail'] }[]) =>
  results.map((result) => result.data);

/**
 * What the profile is in the middle of, for the end screen's "On Deck" row, without the series
 * that just played. Like the web: the watch progress list (`GET /api/v2/progress`, in progress,
 * newest change first) names the items, and each one's catalog detail gives its title and
 * pictures. An entry whose detail has not arrived (or failed) stays out. The hook only runs while
 * the end screen is mounted, so nothing is asked before it.
 */
export function useOnDeck(seriesId: string | undefined): {
  items: readonly CatalogItem[];
  pending: boolean;
} {
  const silo = useSilo();
  const { client, baseUrl, session } = silo;
  const profileId = session.get()?.profileId ?? '';
  const list = useQuery({
    queryKey: ['progress', 'in-progress', baseUrl, profileId],
    // The list changes while the episode plays; an older answer must not stand in for it.
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/progress', {
        params: { query: { status: 'in_progress', limit: ON_DECK_LIMIT } },
      });
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
  const entries = list.data;
  const details = useQueries({
    queries: (entries ?? []).map((entry) => itemDetailOptions(silo, entry.media_item_id)),
    combine: dataOf,
  });
  const items = useMemo(
    () =>
      (entries ?? []).flatMap((entry, index) => {
        const detail = details[index];
        if (!detail || (seriesId !== undefined && detail.series_id === seriesId)) return [];
        return [asCard(detail, entry)];
      }),
    [entries, details, seriesId],
  );
  return { items, pending: list.isPending };
}

/**
 * The card's item: the detail, with the position and length from the progress entry (the detail
 * may not carry them). It is an in-progress item, so the card shows the time left and the bar.
 */
function asCard(detail: components['schemas']['CatalogItemDetail'], entry: ProgressEntry) {
  const item: CatalogItem = {
    ...detail,
    item_source: 'in_progress',
    position_seconds: entry.position_seconds,
    duration_seconds: entry.duration_seconds,
  };
  return item;
}
