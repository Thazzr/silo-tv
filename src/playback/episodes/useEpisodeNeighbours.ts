import { useMemo } from 'react';
import type { components } from '../../api/generated/schema';
import { useSeasonEpisodes, useSeasons } from '../../features/detail/queries';
import {
  NO_NEIGHBOURS,
  neighbourList,
  neighboursOf,
  nextSeasonNumber,
  type Neighbours,
} from './neighbours';

export interface EpisodeNeighbours extends Neighbours {
  /** The reads are in (or failed): `next` null then means there is none, not "not known yet". */
  settled: boolean;
  /** The catalog's own entry of `next` (still, overview, air date), for the Up Next screens. */
  nextEntry: components['schemas']['Episode'] | null;
}

const UNKNOWN: EpisodeNeighbours = { ...NO_NEIGHBOURS, settled: false, nextEntry: null };

/**
 * The previous and next episode of an episode that plays. It reads the series' seasons (to learn
 * whether the next season exists), the current season's episodes and the next season's: the
 * catalog's `/series/{id}/seasons` and `/series/{id}/seasons/{num}/episodes`, the reads the detail
 * page makes, so their cache is shared. Until they arrive there are no neighbours.
 */
export function useEpisodeNeighbours(
  seriesId: string | undefined,
  seasonNumber: number,
  episodeNumber: number,
): EpisodeNeighbours {
  const id = seriesId ?? '';
  const seasons = useSeasons(id, id !== '');
  const next = seasons.data ? nextSeasonNumber(seasons.data, seasonNumber) : undefined;
  const current = useSeasonEpisodes(id, id !== '' ? seasonNumber : undefined);
  const following = useSeasonEpisodes(id, next);
  const currentItems = current.data;
  const followingItems = following.data;
  // Next may need the next season's list: until the reads have answered (or failed) the answer
  // would be wrong at a season's last episode (none, then appearing).
  const settled =
    (seasons.isSuccess || seasons.isError) &&
    (next === undefined || following.isSuccess || following.isError);
  const currentFailed = current.isError;
  return useMemo(() => {
    if (!settled || (!currentItems && !currentFailed)) return UNKNOWN;
    // The season's own list failed: there is nothing to step to.
    if (!currentItems) return { ...NO_NEIGHBOURS, settled: true, nextEntry: null };
    const neighbours = neighboursOf(
      neighbourList(currentItems, followingItems),
      seasonNumber,
      episodeNumber,
    );
    const nextEntry =
      [...currentItems, ...(followingItems ?? [])].find(
        (episode) => episode.content_id === neighbours.next?.contentId,
      ) ?? null;
    return { ...neighbours, settled: true, nextEntry };
  }, [currentItems, currentFailed, followingItems, settled, seasonNumber, episodeNumber]);
}
